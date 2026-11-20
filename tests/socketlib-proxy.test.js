import assert from "node:assert/strict";
import test from "node:test";
import { ModuleSocket } from "../src/scripts/socket.js";
import { SocketlibProxy } from "../src/scripts/socketlib-proxy.js";

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function fixture({ onError } = {}) {
  const queries = {};
  const calls = [];
  const errors = [];
  const users = new Map();
  let singleImplementation;
  let manyImplementation;
  for (const [id, isGM, active] of [
    ["gm", true, true],
    ["other-gm", true, true],
    ["player", false, true],
    ["offline-gm", true, false],
    ["offline-player", false, false],
  ]) {
    users.set(id, {
      id,
      isGM,
      active,
      can: (permission) => permission === "QUERY_USER",
      async query(name, payload, options) {
        const call = { type: "one", target: this, name, payload, options };
        calls.push(call);
        call.response = singleImplementation
          ? await singleImplementation(call)
          : await queries[name](payload, { user: game.user.id });
        return call.response;
      },
    });
  }
  users.filter = (predicate) => [...users.values()].filter(predicate);
  users.activeGM = users.get("other-gm");
  const game = { user: users.get("gm"), users };
  const UserClass = {
    async queryMany(targets, name, payload, options) {
      const call = { type: "many", targets, name, payload, options };
      calls.push(call);
      if (manyImplementation) return manyImplementation(call);
      const outcomes = await Promise.allSettled(targets.map(() => queries[name](payload, { user: game.user.id })));
      return new Map(targets.map((user, index) => [user, outcomes[index]]));
    },
  };
  const socket = new ModuleSocket({
    moduleId: "proxy-fixture",
    getGame: () => game,
    getConfig: () => ({ queries }),
    getUserClass: () => UserClass,
    timeout: 3500,
  });
  const proxy = new SocketlibProxy(socket, {
    getGame: () => game,
    onError: onError ?? ((error, context) => errors.push({ error, context })),
  });
  return {
    socket,
    proxy,
    queries,
    calls,
    errors,
    game,
    users,
    setSingleImplementation(value) {
      singleImplementation = value;
    },
    setManyImplementation(value) {
      manyImplementation = value;
    },
  };
}

test("the cached compatibility proxy can be obtained before Foundry exists and delegates lifecycle state", async () => {
  const unavailable = () => {
    throw new Error("Foundry is not initialized.");
  };
  const socket = new ModuleSocket({ getGame: unavailable, getConfig: unavailable, getUserClass: unavailable });
  const proxy = socket.compat;
  assert.ok(proxy instanceof SocketlibProxy);
  assert.equal(socket.compat, proxy);
  assert.equal(proxy.provider, "foundry");
  assert.equal(proxy.active, false);
  await assert.rejects(proxy.executeAsGM("status"), /not active/u);
  socket.activate();
  assert.equal(proxy.active, true);
  socket.deactivate();
  assert.equal(proxy.active, false);
});

test("proxy registration is namespaced, idempotent, and independent from native payload/options registration", async () => {
  const { socket, proxy, queries, calls } = fixture();
  const nativeHandler = (payload) => payload;
  const handler = (...args) => args;
  const authorize = () => true;
  socket.register("status", nativeHandler).activate();
  assert.equal(proxy.register("status", handler, { authorize }), undefined);
  const receiver = queries["proxy-fixture.compat-status"];
  assert.equal(proxy.register("status", handler, { authorize }), undefined);
  assert.equal(queries["proxy-fixture.compat-status"], receiver);
  assert.notEqual(receiver, queries["proxy-fixture.status"]);
  assert.throws(() => proxy.register("status", () => null, { authorize }), /already registered/u);
  assert.throws(() => proxy.register("status", handler), /already registered/u);
  for (const name of ["", 2, null, undefined, {}]) {
    assert.throws(() => proxy.register(name, handler), /name/u);
  }
  socket.register("compat-foreign", () => null);
  assert.throws(() => proxy.register("foreign", handler), /already registered/u);

  const payload = { native: true };
  assert.deepEqual(await socket.executeAsUser("status", "gm", payload, { timeout: 9000 }), payload);
  assert.deepEqual(calls[0].options, { timeout: 9000 });
  assert.equal(calls[0].payload, payload);
  const finalArgument = { timeout: 1, enabled: true };
  assert.deepEqual(await proxy.executeAsUser("status", "gm", 7, "text", finalArgument), [7, "text", finalArgument]);
  assert.equal(calls[1].name, "proxy-fixture.compat-status");
  assert.deepEqual(calls[1].payload, { args: [7, "text", finalArgument] });
  assert.deepEqual(calls[1].options, { timeout: 3500 });
});

test("function references resolve by first registration order and never send functions over the transport", async () => {
  const { socket, proxy, calls } = fixture();
  const handler = (...args) => args;
  proxy.register("first", handler);
  proxy.register("second", handler);
  socket.activate();
  assert.deepEqual(await proxy.executeAsGM(handler, "argument"), ["argument"]);
  assert.equal(calls[0].name, "proxy-fixture.compat-first");
  assert.deepEqual(calls[0].payload, { args: ["argument"] });
  assert.equal(proxy.unregister("first"), true);
  assert.deepEqual(await proxy.executeAsGM(handler), []);
  assert.equal(calls[1].name, "proxy-fixture.compat-second");
  await assert.rejects(
    proxy.executeAsGM(() => null),
    /not registered/u,
  );
  assert.equal(calls.length, 2);
});

test("legacy names with punctuation, leading underscores, and Unicode have distinct valid native registrations", async () => {
  const { socket, proxy, queries, calls } = fixture();
  const names = ["actor.update", "actor_2eupdate", "_private", "azione 更新"];
  for (const name of names) proxy.register(name, () => name);
  socket.activate();
  assert.equal(Object.keys(queries).length, names.length);
  assert.ok(Object.hasOwn(queries, "proxy-fixture.compat-actor_2eupdate"));
  for (const name of names) assert.equal(await proxy.executeAsGM(name), name);
  assert.equal(new Set(calls.map((call) => call.name)).size, names.length);
  for (const call of calls) assert.match(call.name, /^proxy-fixture\.(?:compat-|compat_)[A-Za-z0-9_-]+$/u);
  for (const name of names) assert.equal(proxy.unregister(name), true);
  assert.deepEqual(queries, {});
});

test("authorization receives the canonical user and variadic arguments while callbacks receive frozen sender context", async () => {
  const { socket, proxy, queries, users } = fixture();
  const authorized = [];
  const handled = [];
  proxy.register(
    "inspect",
    function (...args) {
      assert.equal(Object.isFrozen(this), true);
      assert.equal(Object.isFrozen(this.socketdata), true);
      handled.push({ context: this, args });
      return args;
    },
    {
      authorize: async (user, ...args) => {
        authorized.push({ user, args });
        return user === users.get("player") && args[0] === "allowed";
      },
    },
  );
  socket.activate();
  const spoofed = { userId: "gm", socketdata: { userId: "gm" } };
  const args = ["allowed", spoofed, [1, null, false]];
  const result = await queries["proxy-fixture.compat-inspect"]({ args }, { user: { id: "player", isGM: true } });
  assert.deepEqual(result, { result: [args] });
  assert.equal(authorized[0].user, users.get("player"));
  assert.deepEqual(authorized[0].args, args);
  assert.deepEqual(handled[0].args, args);
  assert.deepEqual(handled[0].context, { socketdata: { userId: "player" } });
  await assert.rejects(
    queries["proxy-fixture.compat-inspect"]({ args: ["denied"] }, { user: "player" }),
    /not authorized/u,
  );
  assert.equal(handled.length, 1);
});

test("default GM authorization and strict true authorization remain enforced through the proxy", async () => {
  const { socket, proxy, queries } = fixture();
  let handled = 0;
  proxy.register("restricted", () => {
    handled += 1;
    return null;
  });
  proxy.register("truthy", () => null, { authorize: () => "allowed" });
  socket.activate();
  await assert.rejects(
    queries["proxy-fixture.compat-restricted"]({ args: [{ userId: "gm" }] }, { user: "player" }),
    /not authorized/u,
  );
  await assert.rejects(queries["proxy-fixture.compat-truthy"]({ args: [] }, { user: "gm" }), /not authorized/u);
  assert.equal(handled, 0);
  assert.deepEqual(await queries["proxy-fixture.compat-restricted"]({ args: [] }, { user: "gm" }), { result: [null] });
  assert.equal(handled, 1);
});

test("malformed argument envelopes never reach authorization or callbacks", async () => {
  const { socket, proxy, queries } = fixture();
  let authorized = 0;
  let handled = 0;
  proxy.register(
    "inspect",
    () => {
      handled += 1;
      return null;
    },
    {
      authorize: () => {
        authorized += 1;
        return true;
      },
    },
  );
  socket.activate();
  for (const envelope of [
    {},
    [],
    { args: null },
    { args: {} },
    { args: [], userId: "gm" },
    { args: [], socketdata: {} },
  ]) {
    await assert.rejects(queries["proxy-fixture.compat-inspect"](envelope, { user: "gm" }), /args envelope/u);
  }
  const cycle = {};
  cycle.self = cycle;
  for (const value of [undefined, NaN, Infinity, 1n, () => {}, new Date(), cycle]) {
    await assert.rejects(queries["proxy-fixture.compat-inspect"]({ args: [value] }, { user: "gm" }), /JSON/u);
  }
  assert.equal(authorized, 0);
  assert.equal(handled, 0);
});

test("undefined, null, and JSON values retain distinct wire results and foreground return values", async () => {
  const { socket, proxy, calls } = fixture();
  let result;
  proxy.register("result", async () => result);
  socket.activate();
  for (const value of [undefined, null, false, 0, "", [], { result: [], nested: [1, "value"] }]) {
    result = value;
    assert.deepEqual(await proxy.executeAsGM("result"), value);
    assert.deepEqual(calls.at(-1).response, { result: value === undefined ? [] : [value] });
  }
  result = new Map();
  await assert.rejects(proxy.executeAsGM("result"), /JSON/u);
});

test("foreground handler and native errors retain their identity and malformed results are rejected", async () => {
  const input = fixture();
  const { socket, proxy, calls } = input;
  const handlerError = new Error("Callback failed.");
  proxy.register("fail", () => {
    throw handlerError;
  });
  proxy.register("result", () => null);
  socket.activate();
  await assert.rejects(proxy.executeAsGM("fail"), (error) => error === handlerError);
  const transportError = new Error("Native timeout.");
  input.setSingleImplementation(() => {
    throw transportError;
  });
  const before = calls.length;
  await assert.rejects(proxy.executeAsUser("result", "player"), (error) => error === transportError);
  assert.equal(calls.length, before + 1);
  for (const value of [null, [], {}, { result: null }, { result: [1, 2] }, { result: [], extra: true }]) {
    input.setSingleImplementation(() => value);
    await assert.rejects(proxy.executeAsGM("result"), /result envelope/u);
  }
});

test("GM execution prefers the current canonical GM and all foreground targets still use native queries", async () => {
  const { socket, proxy, game, users, calls } = fixture();
  proxy.register("status", () => null, { authorize: (user) => user.active });
  socket.activate();
  await proxy.executeAsGM("status");
  assert.equal(calls[0].target, users.get("gm"));
  assert.notEqual(calls[0].target, users.activeGM);
  game.user = users.get("player");
  await proxy.executeAsGM("status");
  assert.equal(calls[1].target, users.get("other-gm"));
  await proxy.executeAsUser("status", "player");
  assert.equal(calls[2].target, game.user);
  users.activeGM = null;
  await assert.rejects(proxy.executeAsGM("status"), /No active GM/u);
  game.user.can = () => false;
  await assert.rejects(proxy.executeAsUser("status", "gm"), /QUERY_USER/u);
  assert.equal(calls.length, 3);
});

test("all five broadcasts select active recipients and leave supplied recipient arrays unchanged", async () => {
  const { socket, proxy, calls, errors } = fixture();
  const handler = () => null;
  proxy.register("status", handler);
  socket.activate();
  const recipients = Object.freeze(["player", "missing", "offline-player", "gm", "player", "offline-gm"]);
  const scenarios = [
    ["executeForAllGMs", ["gm", "other-gm"]],
    ["executeForOtherGMs", ["other-gm"]],
    ["executeForEveryone", ["gm", "other-gm", "player"]],
    ["executeForOthers", ["other-gm", "player"]],
  ];
  for (const [method, expected] of scenarios) {
    assert.equal(await proxy[method](handler, "message", { timeout: 1 }), undefined);
    assert.deepEqual(
      calls.at(-1).targets.map((user) => user.id),
      expected,
    );
    assert.deepEqual(calls.at(-1).payload, { args: ["message", { timeout: 1 }] });
  }
  assert.equal(await proxy.executeForUsers("status", recipients, 42), undefined);
  assert.deepEqual(
    calls.at(-1).targets.map((user) => user.id),
    ["player", "gm"],
  );
  assert.deepEqual(recipients, ["player", "missing", "offline-player", "gm", "player", "offline-gm"]);
  assert.deepEqual(calls.at(-1).options, { timeout: 3500 });
  assert.equal(await proxy.executeForUsers("status", ["missing", "offline-player"]), undefined);
  assert.equal(calls.length, 5);
  await nextTurn();
  assert.deepEqual(errors, []);
});

test("broadcasts resolve without waiting for pending native outcomes and report individual failures once", async () => {
  const input = fixture();
  const { socket, proxy, calls, errors, users } = input;
  const pending = deferred();
  input.setManyImplementation(() => pending.promise);
  proxy.register("status", () => null);
  socket.activate();
  let returned = false;
  const broadcast = proxy.executeForEveryone("status").then((value) => {
    assert.equal(value, undefined);
    returned = true;
  });
  await nextTurn();
  assert.equal(returned, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(errors, []);
  const failure = new Error("Recipient disconnected.");
  pending.resolve(
    new Map([
      [users.get("gm"), { status: "fulfilled", value: { result: [] } }],
      [users.get("player"), { status: "rejected", reason: failure }],
    ]),
  );
  await broadcast;
  await nextTurn();
  assert.deepEqual(errors, [
    { error: failure, context: { method: "executeForEveryone", action: "status", userId: "player" } },
  ]);
  assert.equal(calls.length, 1);
});

test("a self-targeted broadcast uses the native path and does not await the local callback", async () => {
  const { socket, proxy, calls, errors } = fixture();
  const pending = deferred();
  let started = false;
  proxy.register("slow", async () => {
    started = true;
    await pending.promise;
  });
  socket.activate();
  let returned = false;
  const broadcast = proxy.executeForUsers("slow", ["gm"]).then((value) => {
    assert.equal(value, undefined);
    returned = true;
  });
  await nextTurn();
  assert.equal(started, true);
  assert.equal(returned, true);
  assert.equal(calls[0].type, "many");
  assert.deepEqual(
    calls[0].targets.map((user) => user.id),
    ["gm"],
  );
  pending.resolve();
  await broadcast;
  await nextTurn();
  assert.deepEqual(errors, []);
});

test("broadcast JSON, permission, and aggregate transport failures are reported in the background", async (t) => {
  for (const scenario of ["JSON", "permission", "transport"]) {
    await t.test(scenario, async () => {
      const input = fixture();
      const { socket, proxy, calls, errors, game } = input;
      const transportError = new Error("Native fan-out failed.");
      proxy.register("status", () => null);
      socket.activate();
      if (scenario === "permission") game.user.can = () => false;
      if (scenario === "transport")
        input.setManyImplementation(() => {
          throw transportError;
        });
      const args = scenario === "JSON" ? [{ missing: undefined }] : [];
      assert.equal(await proxy.executeForEveryone("status", ...args), undefined);
      await nextTurn();
      assert.equal(errors.length, 1);
      assert.deepEqual(errors[0].context, { method: "executeForEveryone", action: "status" });
      if (scenario === "transport") assert.equal(errors[0].error, transportError);
      else assert.match(errors[0].error.message, scenario === "JSON" ? /JSON/u : /QUERY_USER/u);
      assert.equal(calls.length, scenario === "transport" ? 1 : 0);
    });
  }
});

test("unknown handlers, malformed recipient lists, inactive state, and stale ownership reject before dispatch", async () => {
  const { socket, proxy, calls, errors, queries } = fixture();
  const handler = () => null;
  proxy.register("status", handler);
  socket.activate();
  for (const action of ["missing", () => null, undefined, 1]) {
    await assert.rejects(proxy.executeForEveryone(action), /not registered/u);
  }
  for (const recipients of [undefined, null, "gm", {}, new Set(["gm"])]) {
    await assert.rejects(proxy.executeForUsers("status", recipients), /array/u);
  }
  socket.deactivate();
  await assert.rejects(proxy.executeForEveryone("status"), /not active/u);
  socket.activate();
  const foreign = () => ({ replacement: true });
  socket.unregister("compat-status");
  socket.register("compat-status", foreign);
  const receiver = queries["proxy-fixture.compat-status"];
  await assert.rejects(proxy.executeAsGM("status"), /no longer owned/u);
  await assert.rejects(proxy.executeForEveryone("status"), /no longer owned/u);
  assert.throws(() => proxy.register("status", handler), /no longer owned/u);
  assert.equal(proxy.unregister("status"), false);
  assert.equal(queries["proxy-fixture.compat-status"], receiver);
  assert.equal(socket.ownsRegistration("compat-status", foreign), true);
  assert.deepEqual(calls, []);
  assert.deepEqual(errors, []);
});

test("proxy disposal preserves native registrations and foreign replacements while native disposal clears cached proxy state", () => {
  const { socket, proxy, queries } = fixture();
  const nativeHandler = () => null;
  socket.register("native", nativeHandler).activate();
  proxy.register("own", () => null);
  proxy.register("replaced", () => null);
  const foreign = () => "foreign";
  queries["proxy-fixture.compat-replaced"] = foreign;
  proxy.dispose();
  assert.equal(socket.active, true);
  assert.equal(socket.ownsRegistration("native", nativeHandler), true);
  assert.equal("proxy-fixture.compat-own" in queries, false);
  assert.equal(queries["proxy-fixture.compat-replaced"], foreign);
  assert.equal(proxy.unregister("own"), false);

  const cached = socket.compat;
  cached.register("cached", () => null);
  socket.dispose();
  assert.equal(cached.active, false);
  assert.equal(cached.unregister("cached"), false);
  assert.equal("proxy-fixture.native" in queries, false);
  assert.equal("proxy-fixture.compat-cached" in queries, false);
  assert.equal(queries["proxy-fixture.compat-replaced"], foreign);
});

test("foreign accessors and changed descriptor flags cannot impersonate an owned receiver", async (t) => {
  for (const replacement of ["accessor", "changed flags"]) {
    await t.test(replacement, async () => {
      const { socket, proxy, queries, calls } = fixture();
      const registrations = new Map();
      const nativeRegister = socket.register.bind(socket);
      socket.register = (action, handler, options) => {
        registrations.set(action, { handler, options });
        return nativeRegister(action, handler, options);
      };
      const handler = () => null;
      const names = ["unregisterGuarded", "disposeGuarded"];
      try {
        for (const name of names) proxy.register(name, handler);
      } finally {
        delete socket.register;
      }
      socket.activate();
      const foreignDescriptors = new Map();
      let accessorCalls = 0;
      for (const name of names) {
        const action = `compat-${name}`;
        const key = `proxy-fixture.${action}`;
        const registration = registrations.get(action);
        assert.equal(socket.ownsRegistration(action, registration.handler), true);
        const original = Object.getOwnPropertyDescriptor(queries, key);
        Object.defineProperty(
          queries,
          key,
          replacement === "accessor"
            ? {
                configurable: original.configurable,
                enumerable: original.enumerable,
                get() {
                  accessorCalls += 1;
                  return original.value;
                },
              }
            : { ...original, enumerable: !original.enumerable },
        );
        foreignDescriptors.set(key, Object.getOwnPropertyDescriptor(queries, key));
        assert.equal(socket.ownsRegistration(action, registration.handler), false);
        await assert.rejects(proxy.executeAsGM(name), /no longer owned/u);
        await assert.rejects(socket.executeAsGM(action, { args: [] }), /not registered/u);
        assert.throws(() => proxy.register(name, handler), /no longer owned/u);
        assert.throws(
          () => socket.register(action, registration.handler, registration.options),
          /already registered|replaced/u,
        );
      }
      assert.equal(proxy.unregister("unregisterGuarded"), false);
      proxy.dispose();
      for (const [key, descriptor] of foreignDescriptors) {
        assert.deepEqual(Object.getOwnPropertyDescriptor(queries, key), descriptor);
      }
      assert.equal(accessorCalls, 0);
      assert.deepEqual(calls, []);
    });
  }
});

test("throwing and rejected broadcast error reporters do not create detached rejections", async (t) => {
  const previousError = console.error;
  console.error = () => {};
  t.after(() => {
    console.error = previousError;
  });
  for (const rejectAsync of [false, true]) {
    let reports = 0;
    const reporterFailure = new Error("Reporter failed.");
    const input = fixture({
      onError: () => {
        reports += 1;
        if (rejectAsync) return Promise.reject(reporterFailure);
        throw reporterFailure;
      },
    });
    input.proxy.register("status", () => null);
    input.socket.activate();
    input.setManyImplementation(() => {
      throw new Error("Native failure.");
    });
    assert.equal(await input.proxy.executeForEveryone("status"), undefined);
    await nextTurn();
    await nextTurn();
    assert.equal(reports, 1);
    assert.equal(input.calls.length, 1);
  }
});

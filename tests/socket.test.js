import assert from "node:assert/strict";
import test from "node:test";
import { ModuleSocket, moduleSocket } from "../src/scripts/socket.js";

function fixture({ timeout = 10_000 } = {}) {
  const queries = {};
  const calls = [];
  let singleResult = { ok: true };
  let singleError;
  let manyResult;
  const users = new Map();
  for (const [id, isGM, active] of [
    ["gm", true, true],
    ["player", false, true],
    ["offline", false, false],
  ]) {
    users.set(id, {
      id,
      isGM,
      active,
      can: (permission) => permission === "QUERY_USER",
      async query(name, payload, options) {
        calls.push({ type: "one", target: this, name, payload, options });
        if (singleError) throw singleError;
        return singleResult;
      },
    });
  }
  users.filter = (predicate) => [...users.values()].filter(predicate);
  users.activeGM = users.get("gm");
  const game = { user: users.get("gm"), users };
  const UserClass = {
    async queryMany(targets, name, payload, options) {
      calls.push({ type: "many", targets, name, payload, options });
      return manyResult;
    },
  };
  const socket = new ModuleSocket({
    moduleId: "test-module",
    getGame: () => game,
    getConfig: () => ({ queries }),
    getUserClass: () => UserClass,
    timeout,
  });
  return {
    socket,
    queries,
    calls,
    game,
    users,
    UserClass,
    setSingleResult(value) {
      singleResult = value;
    },
    setSingleError(error) {
      singleError = error;
    },
    setManyResult(value) {
      manyResult = value;
    },
  };
}

test("construction and the exported singleton do not require a Foundry runtime or register handlers", async () => {
  const unavailable = () => {
    throw new Error("Foundry is not initialized.");
  };
  const service = new ModuleSocket({ getGame: unavailable, getConfig: unavailable, getUserClass: unavailable });
  assert.equal(service.provider, "foundry");
  assert.equal(service.active, false);
  assert.equal(moduleSocket.provider, "foundry");
  assert.equal(moduleSocket.active, false);
  await assert.rejects(service.executeAsGM("anything"), /not active/u);
  const input = fixture();
  input.socket.activate();
  assert.deepEqual(input.queries, {});
  await assert.rejects(input.socket.executeAsGM("updateDocument"), /not registered/u);
});

test("registration is possible before ready and received calls require activation", async () => {
  const { socket, queries } = fixture();
  socket.register("status", () => ({ ready: true }));
  await assert.rejects(queries["test-module.status"]({}, { user: "gm" }), /not active/u);
  assert.equal(socket.activate(), socket);
  assert.deepEqual(await queries["test-module.status"]({}, { user: "gm" }), { ready: true });
  socket.deactivate();
  await assert.rejects(queries["test-module.status"]({}, { user: "gm" }), /not active/u);
});

test("default authorization rejects players and spoofed sender fields cannot grant GM rights", async () => {
  const { socket, queries, users } = fixture();
  const received = [];
  socket
    .register("gmAction", (payload, { user }) => {
      received.push({ payload, user });
      return null;
    })
    .activate();
  const receive = queries["test-module.gmAction"];
  const spoofed = { userId: "gm", user: { id: "gm", isGM: true }, senderId: "gm" };
  await assert.rejects(receive(spoofed, { user: "player" }), /not authorized/u);
  await assert.rejects(receive({}, { user: { id: "player", isGM: true, active: true } }), /not authorized/u);
  for (const context of [undefined, {}, { user: "missing" }, { user: "offline" }]) {
    await assert.rejects(receive(spoofed, context), /Query sender/u);
  }
  assert.deepEqual(received, []);
  await receive({ userId: "player" }, { user: { id: "gm", isGM: false } });
  assert.equal(received[0].user, users.get("gm"));
  assert.equal(received[0].payload.userId, "player");
});

test("explicit async authorization receives the canonical user and payload", async () => {
  const { socket, queries, users } = fixture();
  socket
    .register("getStatus", (_payload, { user }) => ({ requestedBy: user.id }), {
      authorize: async (user, payload) => user === users.get("player") && payload.allowed === true,
    })
    .activate();
  assert.deepEqual(await queries["test-module.getStatus"]({ allowed: true }, { user: "player" }), {
    requestedBy: "player",
  });
  await assert.rejects(queries["test-module.getStatus"]({ allowed: false }, { user: "player" }), /not authorized/u);
});

test("single-user and GM routes use native queries, including self-targets, and forward timeouts", async () => {
  const input = fixture({ timeout: 1500 });
  const { socket, game, users, calls } = input;
  socket.register("ping", () => null).activate();
  const response = { remote: true };
  input.setSingleResult(response);
  const payload = { greeting: "hello" };
  assert.equal(await socket.executeAsUser("ping", "gm", payload), response);
  assert.equal(calls[0].target, game.user);
  assert.equal(calls[0].name, "test-module.ping");
  assert.equal(calls[0].payload, payload);
  assert.deepEqual(calls[0].options, { timeout: 1500 });
  await socket.executeAsUser("ping", "player", {}, { timeout: 2500 });
  assert.equal(calls[1].target, users.get("player"));
  assert.deepEqual(calls[1].options, { timeout: 2500 });
  game.user = users.get("player");
  await socket.executeAsGM("ping");
  assert.equal(calls[2].target, users.get("gm"));
});

test("native rejection is preserved and no retry occurs", async () => {
  const input = fixture();
  input.socket.register("ping", () => null).activate();
  const error = new Error("Native query timed out.");
  input.setSingleError(error);
  await assert.rejects(input.socket.executeAsGM("ping"), (actual) => actual === error);
  assert.equal(input.calls.length, 1);
});

test("fan-out delegates once to queryMany, deduplicates users, and preserves settled results", async () => {
  const input = fixture();
  const { socket, users, calls } = input;
  socket.register("ping", () => null).activate();
  const failure = new Error("Disconnected.");
  const results = new Map([
    [users.get("gm"), { status: "fulfilled", value: { pong: true } }],
    [users.get("player"), { status: "rejected", reason: failure }],
  ]);
  input.setManyResult(results);
  assert.equal(await socket.executeForUsers("ping", ["gm", "player", "gm"], {}, { timeout: 8000 }), results);
  assert.equal(calls[0].type, "many");
  assert.deepEqual(calls[0].targets, [users.get("gm"), users.get("player")]);
  assert.deepEqual(calls[0].options, { timeout: 8000 });
  await socket.executeForEveryone("ping");
  assert.deepEqual(calls[1].targets, [users.get("gm"), users.get("player")]);
  await socket.executeForOthers("ping");
  assert.deepEqual(calls[2].targets, [users.get("player")]);
  assert.deepEqual(await socket.executeForUsers("ping", []), new Map());
  assert.equal(calls.length, 3);
});

test("invalid recipients, missing GM, inactive service, and denied query permission prevent dispatch", async () => {
  const { socket, users, calls, game } = fixture();
  socket.register("ping", () => null).activate();
  for (const id of ["offline", "missing", "", null]) {
    await assert.rejects(socket.executeAsUser("ping", id), /Query target/u);
  }
  await assert.rejects(socket.executeForUsers("ping", ["gm", "missing"]), /Query target/u);
  await assert.rejects(socket.executeForUsers("ping", "gm"), /iterable/u);
  users.activeGM = null;
  await assert.rejects(socket.executeAsGM("ping"), /No active GM/u);
  game.user.can = () => false;
  await assert.rejects(socket.executeAsUser("ping", "player"), /QUERY_USER/u);
  socket.deactivate();
  await assert.rejects(socket.executeForEveryone("ping"), /not active/u);
  assert.deepEqual(calls, []);
});

test("invalid payloads and timeouts fail before transport or handler execution", async () => {
  const { socket, queries, calls } = fixture();
  let handled = 0;
  socket
    .register("ping", () => {
      handled += 1;
      return null;
    })
    .activate();
  const cycle = {};
  cycle.self = cycle;
  for (const payload of [
    null,
    1,
    "text",
    { value: undefined },
    { value: NaN },
    { value: Infinity },
    { value: 1n },
    { value() {} },
    { value: new Date() },
    { value: new Map() },
    cycle,
  ]) {
    await assert.rejects(socket.executeAsUser("ping", "gm", payload), /JSON/u);
    await assert.rejects(queries["test-module.ping"](payload, { user: "gm" }), /JSON/u);
  }
  for (const timeout of [0, -1, Infinity, NaN, "1000", null, 2_147_483_648]) {
    assert.throws(() => new ModuleSocket({ timeout }), /timeout/u);
    await assert.rejects(socket.executeAsUser("ping", "gm", {}, { timeout }), /timeout/u);
  }
  await assert.rejects(socket.executeAsUser("ping", "gm", {}, null), /options/u);
  assert.deepEqual(calls, []);
  assert.equal(handled, 0);
});

test("handler failures keep their identity and non-JSON results are rejected", async () => {
  const { socket, queries } = fixture();
  const expected = new Error("The operation failed.");
  socket.register("fail", () => {
    throw expected;
  });
  socket.register("invalidResult", () => new Map());
  socket.activate();
  await assert.rejects(queries["test-module.fail"]({}, { user: "gm" }), (actual) => actual === expected);
  await assert.rejects(queries["test-module.invalidResult"]({}, { user: "gm" }), /JSON/u);
});

test("duplicate registration is idempotent only for the same handler and policy", () => {
  const { socket, queries } = fixture();
  const handler = () => null;
  const authorize = (user) => user.active;
  socket.register("ping", handler, { authorize });
  const original = queries["test-module.ping"];
  assert.equal(socket.register("ping", handler, { authorize }), socket);
  assert.equal(queries["test-module.ping"], original);
  assert.throws(() => socket.register("ping", () => null, { authorize }), /already registered/u);
  assert.throws(() => socket.register("ping", handler), /already registered/u);
  queries["test-module.foreign"] = () => "another module";
  assert.throws(() => socket.register("foreign", handler), /already registered/u);
  for (const action of ["", "name.with.dots", "../action", "__proto__", 2]) {
    assert.throws(() => socket.register(action, handler), /action/u);
  }
});

test("unregister and disposal remove only owned registrations", async () => {
  const { socket, queries } = fixture();
  socket
    .register("own", () => null)
    .register("replaced", () => null)
    .activate();
  const previousReceiver = queries["test-module.own"];
  const foreign = () => "foreign";
  queries["test-module.replaced"] = foreign;
  await assert.rejects(socket.executeAsGM("replaced"), /not registered/u);
  assert.equal(socket.unregister("own"), true);
  assert.equal(socket.unregister("own"), false);
  assert.equal("test-module.own" in queries, false);
  await assert.rejects(previousReceiver({}, { user: "gm" }), /not registered/u);
  socket.dispose();
  assert.equal(socket.active, false);
  assert.equal(queries["test-module.replaced"], foreign);
});

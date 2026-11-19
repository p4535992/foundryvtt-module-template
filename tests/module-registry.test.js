import assert from "node:assert/strict";
import test from "node:test";
import { MODULE_ID } from "../src/scripts/constants.js";
import { registerModuleApi, registerModuleSocket } from "../src/scripts/module-registry.js";

/** Model the documented distinction between a prepared field and its persisted source. */
class ModuleRecord {
  constructor(flag = false) {
    this._source = Object.seal({ id: MODULE_ID, socket: flag });
    this.socket = flag;
  }

  toObject(source = true) {
    return source ? { ...this._source } : { ...this._source, socket: this.socket };
  }

  toJSON() {
    return this.toObject(true);
  }
}

function installModule(t, module = new ModuleRecord()) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "game");
  Object.defineProperty(globalThis, "game", {
    configurable: true,
    writable: true,
    value: { modules: new Map(module ? [[MODULE_ID, module]] : []) },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "game", previous);
    else delete globalThis.game;
  });
  return module;
}

for (const flag of [false, true]) {
  test(`required runtime aliases preserve the original ${flag} manifest socket flag`, (t) => {
    const module = installModule(t, new ModuleRecord(flag));
    const originalDescriptor = Object.getOwnPropertyDescriptor(module, "socket");
    const socket = { active: true, provider: "foundry" };
    const api = { socket, open() {} };

    assert.equal(registerModuleApi(api), module);
    const restore = registerModuleSocket(socket);
    assert.equal(module.api, api);
    assert.equal(module.api.socket, socket);
    assert.equal(module.socket, socket);
    assert.equal(module._source.socket, flag);
    assert.equal(module.toObject().socket, flag);
    assert.equal(module.toObject(true).socket, flag);
    assert.equal(module.toJSON().socket, flag);
    assert.equal(JSON.parse(JSON.stringify(module)).socket, flag);
    assert.equal(module.toObject(false).socket, socket, "Prepared-state export is intentionally distinct.");

    restore();
    assert.deepEqual(Object.getOwnPropertyDescriptor(module, "socket"), originalDescriptor);
    assert.equal(module.api.socket, socket, "Restoring the alias does not remove the canonical API service.");
    restore();
    assert.equal(module.socket, flag);
  });
}

test("registering the same alias again is harmless and does not acquire restoration ownership", (t) => {
  const module = installModule(t);
  const socket = { active: true };
  registerModuleApi({ socket });
  const restoreOriginal = registerModuleSocket(socket);
  const restoreRepeated = registerModuleSocket(socket);

  restoreRepeated();
  assert.equal(module.socket, socket);
  restoreOriginal();
  assert.equal(module.socket, false);
  restoreRepeated();
  assert.equal(module.socket, false);
});

test("restoration does not overwrite a replacement service owned by another caller", (t) => {
  const module = installModule(t);
  const ownSocket = { active: true };
  const otherSocket = { active: true, provider: "other" };
  const restore = registerModuleSocket(ownSocket);
  module.socket = otherSocket;
  const otherDescriptor = Object.getOwnPropertyDescriptor(module, "socket");

  restore();
  assert.deepEqual(Object.getOwnPropertyDescriptor(module, "socket"), otherDescriptor);
  assert.equal(module.socket, otherSocket);
  assert.equal(module.toObject(true).socket, false);
});

test("restoration neither evaluates nor overwrites a foreign accessor returning the same service", (t) => {
  const module = installModule(t);
  const socket = { active: true };
  const restore = registerModuleSocket(socket);
  let reads = 0;
  const replacement = {
    configurable: true,
    enumerable: true,
    get() {
      reads += 1;
      return socket;
    },
  };
  Object.defineProperty(module, "socket", replacement);

  restore();
  assert.equal(reads, 0);
  assert.deepEqual(Object.getOwnPropertyDescriptor(module, "socket"), {
    ...replacement,
    set: undefined,
  });
});

test("inactive services are rejected without changing the field or manifest", (t) => {
  const module = installModule(t);
  const descriptor = Object.getOwnPropertyDescriptor(module, "socket");
  for (const socket of [undefined, null, {}, { active: false }]) {
    assert.throws(() => registerModuleSocket(socket), /must be active/u);
    assert.deepEqual(Object.getOwnPropertyDescriptor(module, "socket"), descriptor);
    assert.equal(module.toJSON().socket, false);
  }
});

test("accessor and nonwritable fields are rejected without invoking their accessors", (t) => {
  const module = installModule(t);
  const socket = { active: true };
  let reads = 0;
  let writes = 0;
  const getter = () => {
    reads += 1;
    return socket;
  };
  Object.defineProperty(module, "socket", {
    configurable: true,
    enumerable: true,
    get: getter,
    set() {
      writes += 1;
    },
  });
  const accessor = Object.getOwnPropertyDescriptor(module, "socket");
  assert.throws(() => registerModuleSocket(socket), /cannot safely expose/u);
  assert.equal(reads, 0);
  assert.equal(writes, 0);
  assert.deepEqual(Object.getOwnPropertyDescriptor(module, "socket"), accessor);

  Object.defineProperty(module, "socket", { configurable: true, enumerable: true, writable: false, value: false });
  const readonly = Object.getOwnPropertyDescriptor(module, "socket");
  assert.throws(() => registerModuleSocket(socket), /cannot safely expose/u);
  assert.deepEqual(Object.getOwnPropertyDescriptor(module, "socket"), readonly);
  assert.equal(module.toObject(true).socket, false);
});

test("missing or invalid runtime fields and source flags are rejected before alias installation", (t) => {
  const module = installModule(t);
  const socket = { active: true };
  delete module.socket;
  assert.throws(() => registerModuleSocket(socket), /cannot safely expose/u);
  assert.equal(Object.hasOwn(module, "socket"), false);

  for (const value of [null, 0, "false", {}]) {
    module.socket = value;
    const descriptor = Object.getOwnPropertyDescriptor(module, "socket");
    assert.throws(() => registerModuleSocket(socket), /cannot safely expose/u);
    assert.deepEqual(Object.getOwnPropertyDescriptor(module, "socket"), descriptor);
  }
  module.socket = false;
  module._source.socket = "false";
  assert.throws(() => registerModuleSocket(socket), /boolean socket flag/u);
  assert.equal(module.socket, false);
  assert.equal(module._source.socket, "false");

  module._source.socket = false;
  module.toJSON = () => ({ id: MODULE_ID, socket: true });
  assert.throws(() => registerModuleSocket(socket), /boolean socket flag/u);
  assert.equal(module.socket, false);
});

test("missing serializers are rejected before installing the runtime alias", (t) => {
  const module = installModule(t);
  const socket = { active: true };
  for (const method of ["toObject", "toJSON"]) {
    module[method] = undefined;
    assert.throws(() => registerModuleSocket(socket), /serialization is unavailable/u);
    assert.equal(module.socket, false);
    delete module[method];
  }
});

for (const method of ["toObject", "toJSON"]) {
  test(`alias installation rolls back when ${method} exports the prepared runtime service`, (t) => {
    const module = installModule(t);
    const originalDescriptor = Object.getOwnPropertyDescriptor(module, "socket");
    module[method] = function () {
      return { ...this._source, socket: this.socket };
    };
    assert.throws(() => registerModuleSocket({ active: true }), /must not change the serialized/u);
    assert.deepEqual(Object.getOwnPropertyDescriptor(module, "socket"), originalDescriptor);
    assert.equal(module._source.socket, false);
    assert.equal(module.toJSON().socket, false);
  });
}

test("a serializer failure after installation restores the original field and preserves the error", (t) => {
  const module = installModule(t);
  const originalDescriptor = Object.getOwnPropertyDescriptor(module, "socket");
  const expected = new Error("Serializer cannot export runtime objects.");
  module.toJSON = function () {
    if (typeof this.socket !== "boolean") throw expected;
    return { ...this._source };
  };

  assert.throws(
    () => registerModuleSocket({ active: true }),
    (error) => error === expected,
  );
  assert.deepEqual(Object.getOwnPropertyDescriptor(module, "socket"), originalDescriptor);
  assert.equal(module.toJSON().socket, false);
});

test("registration reports when Foundry has not created the module record", (t) => {
  installModule(t, null);
  assert.throws(() => registerModuleApi({}), /did not register/u);
  assert.throws(() => registerModuleSocket({ active: true }), /did not register/u);
});

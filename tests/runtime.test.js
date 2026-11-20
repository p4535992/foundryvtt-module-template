import assert from "node:assert/strict";
import test from "node:test";
import { ModuleApi, moduleApi } from "../src/scripts/api.js";
import { onInit } from "../src/scripts/hooks/init.js";
import { onSetup } from "../src/scripts/hooks/setup.js";
import { onReady } from "../src/scripts/hooks/ready.js";
import { MODULE_ID, MODULE_PATH, MODULE_TITLE, translationKey } from "../src/scripts/constants.js";
import { moduleSocket } from "../src/scripts/socket.js";
import { getLibWrapper, LibWrapperFallback } from "../src/scripts/lib/libwrapper-shim.js";
import { configureLogging, reportError } from "../src/scripts/logger.js";

function createApiController(openApplication) {
  const api = new ModuleApi({ openApplication, socket: null });
  return {
    api,
    markReady: () => api._markReady(),
    fail: (error) => api._failInitialization(error),
  };
}

test("lifecycle exposes the public API and active socket after services are ready", async (t) => {
  const previousGame = globalThis.game;
  const previousConfig = globalThis.CONFIG;
  const previousFoundry = globalThis.foundry;
  const previousHooks = globalThis.Hooks;
  let phase = "init";
  const registered = [];
  const reads = [];
  const loadedTemplates = [];
  const emitted = [];
  const source = { socket: true, version: "14.0.0" };
  const installedModule = { ...source, toObject: () => ({ ...source }), toJSON: () => ({ ...source }) };
  const user = { id: "current-user", active: true, isGM: false, can: () => true };
  globalThis.game = {
    modules: new Map([[moduleApi.id, installedModule]]),
    user,
    users: new Map([[user.id, user]]),
    settings: {
      register(namespace, key) {
        assert.equal(phase, "init");
        registered.push({ namespace, key });
      },
      get(namespace, key) {
        if (phase === "init") throw new Error("Settings storage is unavailable during init.");
        reads.push({ namespace, key, phase });
        return false;
      },
    },
  };
  globalThis.CONFIG = { queries: {} };
  globalThis.foundry = {
    applications: { handlebars: { loadTemplates: async (templates) => loadedTemplates.push(...templates) } },
  };
  globalThis.Hooks = { callAll: (...args) => emitted.push(args) };
  t.after(() => {
    moduleSocket.dispose();
    if (previousGame === undefined) delete globalThis.game;
    else globalThis.game = previousGame;
    if (previousConfig === undefined) delete globalThis.CONFIG;
    else globalThis.CONFIG = previousConfig;
    if (previousFoundry === undefined) delete globalThis.foundry;
    else globalThis.foundry = previousFoundry;
    if (previousHooks === undefined) delete globalThis.Hooks;
    else globalThis.Hooks = previousHooks;
    configureLogging({ debug: false });
  });

  onInit();
  assert.equal(installedModule.api, moduleApi);
  assert.ok(installedModule.api instanceof ModuleApi);
  assert.equal(registered.length, 1);
  assert.deepEqual(reads, []);
  assert.equal(moduleApi.ready, false);
  assert.equal(moduleApi.socket.active, false);
  assert.equal(installedModule.socket, true);
  assert.equal(typeof globalThis.CONFIG.queries[`${MODULE_ID}.getStatus`], "function");

  phase = "setup";
  onSetup();
  assert.deepEqual(reads, [{ namespace: moduleApi.id, key: "debug", phase: "setup" }]);

  phase = "ready";
  await onReady();
  assert.equal(await moduleApi.whenReady, moduleApi);
  assert.equal(installedModule.socket, moduleApi.socket);
  assert.equal(installedModule.socket.active, true);
  assert.equal(installedModule.socket.compat, moduleApi.socket.compat);
  assert.equal(installedModule.socket.compat.active, true);
  assert.equal(installedModule.toObject(true).socket, true);
  assert.deepEqual(loadedTemplates, [`${MODULE_PATH}/templates/module-settings.hbs`]);
  assert.deepEqual(emitted, [[`${MODULE_ID}.ready`, moduleApi]]);
  const status = await globalThis.CONFIG.queries[`${MODULE_ID}.getStatus`]({}, { user });
  assert.deepEqual(status, {
    id: MODULE_ID,
    title: MODULE_TITLE,
    version: "14.0.0",
    ready: true,
    status: "ready",
    socketActive: true,
    socketProvider: "foundry",
  });
  assert.deepEqual(await globalThis.CONFIG.queries[`${MODULE_ID}.compat-getStatus`]({ args: [] }, { user }), {
    result: [status],
  });
});

test("the public API waits for initialization and coalesces simultaneous opens", async () => {
  let openCount = 0;
  let completeOpen;
  let signalStarted;
  const started = new Promise((resolve) => {
    signalStarted = resolve;
  });
  const application = { id: "settings" };
  const controller = createApiController(() => {
    openCount += 1;
    signalStarted();
    return new Promise((resolve) => {
      completeOpen = resolve;
    });
  });

  const first = controller.api.open();
  const second = controller.api.openSettings();
  await Promise.resolve();
  assert.equal(openCount, 0);
  assert.equal(controller.api.ready, false);

  controller.markReady();
  controller.markReady();
  assert.equal(await controller.api.whenReady, controller.api);
  await started;
  assert.equal(openCount, 1);
  completeOpen(application);
  assert.deepEqual(await Promise.all([first, second]), [application, application]);
  assert.equal(controller.api.status, "ready");
});

test("error reporting preserves a startup failure even if UI services are unavailable", (t) => {
  const previousGame = globalThis.game;
  const previousUi = globalThis.ui;
  const previousError = console.error;
  const previousWarn = console.warn;
  const logged = [];
  globalThis.game = {
    i18n: {
      format() {
        throw new Error("Localization is unavailable.");
      },
    },
  };
  globalThis.ui = {
    notifications: {
      error() {
        throw new Error("Notifications are unavailable.");
      },
    },
  };
  console.error = (...values) => {
    logged.push(values);
  };
  console.warn = () => {};
  t.after(() => {
    if (previousGame === undefined) delete globalThis.game;
    else globalThis.game = previousGame;
    if (previousUi === undefined) delete globalThis.ui;
    else globalThis.ui = previousUi;
    console.error = previousError;
    console.warn = previousWarn;
  });

  const original = new Error("Registration failed.");
  assert.doesNotThrow(() => reportError("Initialization", original));
  assert.equal(logged[0].at(-1), original);
});

test("an initialization failure rejects waiting callers and cannot become ready", async () => {
  let opened = false;
  const controller = createApiController(() => {
    opened = true;
  });
  const expected = new Error("Template loading failed");
  const waitingOpen = assert.rejects(controller.api.open(), (error) => error === expected);
  const waitingReady = assert.rejects(controller.api.whenReady, (error) => error === expected);

  controller.fail(expected);
  controller.markReady();
  await Promise.all([waitingOpen, waitingReady]);
  assert.equal(controller.api.status, "failed");
  assert.equal(controller.api.error, expected);
  assert.equal(opened, false);
});

test("a window-opening failure can be retried without corrupting readiness", async () => {
  let attempts = 0;
  const application = { id: "recovered" };
  const controller = createApiController(() => {
    attempts += 1;
    if (attempts === 1) throw new Error("Rendering failed");
    return application;
  });
  controller.markReady();

  await assert.rejects(controller.api.open(), /Rendering failed/);
  assert.equal(await controller.api.open(), application);
  assert.equal(attempts, 2);
  assert.equal(controller.api.ready, true);
});

test("the public API reports the installed package version", (t) => {
  const previous = globalThis.game;
  const controller = createApiController(() => {});
  globalThis.game = {
    modules: new Map([[controller.api.id, { version: "2.3.4" }]]),
  };
  t.after(() => {
    if (previous === undefined) delete globalThis.game;
    else globalThis.game = previous;
  });
  assert.equal(controller.api.version, "2.3.4");
});

test("the settings application manages the real client debug setting", async (t) => {
  const previousGame = globalThis.game;
  const previousFoundry = globalThis.foundry;
  let debug = false;
  const writes = [];
  const renders = [];
  class ApplicationV2 {
    async _prepareContext() {
      return { inherited: true };
    }
    async render(options) {
      renders.push(options);
      return this;
    }
  }
  globalThis.foundry = {
    applications: { api: { ApplicationV2, HandlebarsApplicationMixin: (Base) => class extends Base {} } },
  };
  globalThis.game = {
    modules: new Map([[MODULE_ID, { version: "14.0.0" }]]),
    settings: {
      get(namespace, key) {
        assert.equal(namespace, MODULE_ID);
        assert.equal(key, "debug");
        return debug;
      },
      async set(namespace, key, value) {
        writes.push({ namespace, key, value });
        debug = value;
        return value;
      },
    },
  };
  t.after(() => {
    if (previousGame === undefined) delete globalThis.game;
    else globalThis.game = previousGame;
    if (previousFoundry === undefined) delete globalThis.foundry;
    else globalThis.foundry = previousFoundry;
  });

  const { ModuleSettingsApplication } = await import("../src/scripts/applications/module-settings.js");
  const application = new ModuleSettingsApplication();
  const context = await application._prepareContext({});
  assert.equal(context.inherited, true);
  assert.equal(context.moduleTitle, MODULE_TITLE);
  assert.equal(context.enabled, false);
  assert.equal(context.labels.toggle, translationKey("Application.EnableDebug"));
  assert.equal(ModuleSettingsApplication.DEFAULT_OPTIONS.id, `${MODULE_ID}-settings`);
  assert.equal(ModuleSettingsApplication.PARTS.content.template, `${MODULE_PATH}/templates/module-settings.hbs`);

  let prevented = false;
  const button = { disabled: false };
  await ModuleSettingsApplication.toggleDebug.call(application, { preventDefault: () => (prevented = true) }, button);
  assert.equal(prevented, true);
  assert.equal(button.disabled, false);
  assert.deepEqual(writes, [{ namespace: MODULE_ID, key: "debug", value: true }]);
  assert.deepEqual(renders, [{ force: false }]);
  const refreshed = await application._prepareContext({});
  assert.equal(refreshed.enabled, true);
  assert.equal(refreshed.labels.toggle, translationKey("Application.DisableDebug"));
});

test("the fallback preserves method context, arguments, return values, and an inherited method", (t) => {
  const prototype = {
    multiply(value) {
      return this.factor * value;
    },
  };
  const target = Object.assign(Object.create(prototype), { factor: 3 });
  globalThis.__moduleTemplateTest = target;
  t.after(() => {
    delete globalThis.__moduleTemplateTest;
  });

  LibWrapperFallback.register(
    "test",
    "__moduleTemplateTest.multiply",
    function (wrapped, value) {
      assert.equal(this, target);
      return wrapped(value + 1) + 2;
    },
    "WRAPPER",
  );

  assert.equal(target.multiply(2), 11);
  assert.equal(prototype.multiply.call({ factor: 2 }, 2), 4);
});

test("the fallback handles a quoted getter and setter without altering the other accessor", (t) => {
  const target = {
    value: 2,
    get ["sample.value"]() {
      return this.value;
    },
    set ["sample.value"](value) {
      this.value = value;
    },
  };
  globalThis.__moduleTemplateTest = target;
  t.after(() => {
    delete globalThis.__moduleTemplateTest;
  });

  LibWrapperFallback.register(
    "test",
    "__moduleTemplateTest['sample.value']",
    function (wrapped) {
      return wrapped() * 2;
    },
    "WRAPPER",
  );
  LibWrapperFallback.register(
    "test",
    '__moduleTemplateTest["sample.value"]#set',
    function (wrapped, value) {
      return wrapped(value + 1);
    },
    "WRAPPER",
  );

  target["sample.value"] = 4;
  assert.equal(target.value, 5);
  assert.equal(target["sample.value"], 10);
  assert.throws(() => LibWrapperFallback.register("test", "__moduleTemplateTest.missing", () => {}), /missing/);
});

test("real libWrapper is preferred without creating a fallback registration", (t) => {
  const previous = globalThis.libWrapper;
  const real = { is_fallback: false, register() {} };
  globalThis.libWrapper = real;
  t.after(() => {
    if (previous === undefined) delete globalThis.libWrapper;
    else globalThis.libWrapper = previous;
  });

  assert.equal(getLibWrapper(), real);
  delete globalThis.libWrapper;
  assert.equal(getLibWrapper(), LibWrapperFallback);
});

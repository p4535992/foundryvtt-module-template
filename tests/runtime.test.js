import assert from "node:assert/strict";
import test from "node:test";
import { createApiController, moduleApi } from "../src/scripts/api.js";
import { onInit } from "../src/scripts/hooks/init.js";
import { onSetup } from "../src/scripts/hooks/setup.js";
import { getLibWrapper, LibWrapperFallback } from "../src/scripts/lib/libwrapper-shim.js";
import { configureLogging, reportError } from "../src/scripts/logger.js";

test("init registers settings without reading storage until setup", (t) => {
  const previousGame = globalThis.game;
  const previousHandlebars = globalThis.Handlebars;
  let phase = "init";
  const registered = [];
  const reads = [];
  const installedModule = {};
  globalThis.game = {
    modules: new Map([[moduleApi.id, installedModule]]),
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
  globalThis.Handlebars = { registerHelper() {} };
  t.after(() => {
    if (previousGame === undefined) delete globalThis.game;
    else globalThis.game = previousGame;
    if (previousHandlebars === undefined) delete globalThis.Handlebars;
    else globalThis.Handlebars = previousHandlebars;
    configureLogging({ debug: false });
  });

  onInit();
  assert.equal(installedModule.api, moduleApi);
  assert.equal(registered.length, 2);
  assert.deepEqual(reads, []);

  phase = "setup";
  onSetup();
  assert.deepEqual(reads, [{ namespace: moduleApi.id, key: "debug", phase: "setup" }]);
});

test("the public API waits for initialization and coalesces simultaneous opens", async () => {
  let openCount = 0;
  let completeOpen;
  let signalStarted;
  const started = new Promise((resolve) => { signalStarted = resolve; });
  const application = { id: "demo" };
  const controller = createApiController(() => {
    openCount += 1;
    signalStarted();
    return new Promise((resolve) => { completeOpen = resolve; });
  });

  const first = controller.api.open();
  const second = controller.api.open();
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
  globalThis.game = { i18n: { format() { throw new Error("Localization is unavailable."); } } };
  globalThis.ui = { notifications: { error() { throw new Error("Notifications are unavailable."); } } };
  console.error = (...values) => { logged.push(values); };
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
  const controller = createApiController(() => { opened = true; });
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

test("the public API reports the installed package version after release stamping", (t) => {
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

test("the fallback preserves method context, arguments, return values, and an inherited method", (t) => {
  const prototype = {
    multiply(value) { return this.factor * value; },
  };
  const target = Object.assign(Object.create(prototype), { factor: 3 });
  globalThis.__moduleTemplateTest = target;
  t.after(() => { delete globalThis.__moduleTemplateTest; });

  LibWrapperFallback.register("test", "__moduleTemplateTest.multiply", function (wrapped, value) {
    assert.equal(this, target);
    return wrapped(value + 1) + 2;
  }, "WRAPPER");

  assert.equal(target.multiply(2), 11);
  assert.equal(prototype.multiply.call({ factor: 2 }, 2), 4);
});

test("the fallback handles a quoted getter and setter without altering the other accessor", (t) => {
  const target = {
    value: 2,
    get ["sample.value"]() { return this.value; },
    set ["sample.value"](value) { this.value = value; },
  };
  globalThis.__moduleTemplateTest = target;
  t.after(() => { delete globalThis.__moduleTemplateTest; });

  LibWrapperFallback.register("test", "__moduleTemplateTest['sample.value']", function (wrapped) {
    return wrapped() * 2;
  }, "WRAPPER");
  LibWrapperFallback.register("test", '__moduleTemplateTest["sample.value"]#set', function (wrapped, value) {
    return wrapped(value + 1);
  }, "WRAPPER");

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

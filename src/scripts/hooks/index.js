import { failModuleInitialization, moduleApi } from "../api.js";
import { logger, reportError } from "../logger.js";
import { onInit } from "./init.js";
import { onSetup } from "./setup.js";
import { onReady } from "./ready.js";

let registered = false;

async function runStage(name, handler) {
  if (moduleApi.status === "failed") return;
  try {
    await handler();
    logger.debug(`Lifecycle stage completed: ${name}`);
  } catch (error) {
    failModuleInitialization(error);
    reportError(`Initialization (${name})`, error);
  }
}

export function registerHooks() {
  if (registered) return;
  registered = true;

  Hooks.once("init", () => runStage("init", onInit));
  Hooks.once("setup", () => runStage("setup", onSetup));
  Hooks.once("ready", () => runStage("ready", onReady));
}

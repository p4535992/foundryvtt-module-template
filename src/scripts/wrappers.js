import { MODULE_ID, translationKey } from "./constants.js";
import { getLibWrapper } from "./lib/libwrapper-shim.js";
import { logger } from "./logger.js";

// Add deliberate module integrations here. The starter patches nothing by default.
// Each entry has { target, wrapper, type: "WRAPPER", options: {} }.
const definitions = [];
let fallbackWarningScheduled = false;

function warnAboutFallback() {
  if (fallbackWarningScheduled) return;
  fallbackWarningScheduled = true;
  logger.warn("Using the basic libWrapper fallback. Enable libWrapper for better compatibility.");

  const notify = () => {
    if (game.user?.isGM) {
      ui.notifications.warn(game.i18n.localize(translationKey("Warnings.LibWrapperFallback")));
    }
  };
  if (game.ready) notify();
  else Hooks.once("ready", notify);
}

export function registerWrapper(target, wrapper, type = "WRAPPER", options = {}) {
  const implementation = getLibWrapper();
  const registration = implementation.register(MODULE_ID, target, wrapper, type, options);
  if (implementation.is_fallback) warnAboutFallback();
  return registration;
}

export function registerConfiguredWrappers() {
  for (const { target, wrapper, type, options } of definitions) {
    registerWrapper(target, wrapper, type, options);
  }
}

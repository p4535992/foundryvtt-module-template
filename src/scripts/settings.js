import { MODULE_ID, translationKey } from "./constants.js";
import { configureLogging } from "./logger.js";

export const SETTING_KEYS = Object.freeze({
  debug: "debug",
});

export function registerSettings() {
  game.settings.register(MODULE_ID, SETTING_KEYS.debug, {
    name: translationKey("Settings.Debug.Name"),
    hint: translationKey("Settings.Debug.Hint"),
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
    onChange: (debug) => configureLogging({ debug }),
  });
}

export function initializeSettings() {
  // Stored settings become readable during setup, after registration in init.
  configureLogging({ debug: game.settings.get(MODULE_ID, SETTING_KEYS.debug) });
}

export function getDebugEnabled() {
  return game.settings.get(MODULE_ID, SETTING_KEYS.debug);
}

export async function setDebugEnabled(enabled) {
  if (typeof enabled !== "boolean") throw new TypeError("The debug setting must be a boolean.");
  return game.settings.set(MODULE_ID, SETTING_KEYS.debug, enabled);
}

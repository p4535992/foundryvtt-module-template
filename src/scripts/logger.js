import { MODULE_ID, translationKey } from "./constants.js";

let debugEnabled = false;

export function configureLogging({ debug = false } = {}) {
  debugEnabled = Boolean(debug);
}

export const logger = Object.freeze({
  debug(...values) {
    if (debugEnabled) console.debug(`${MODULE_ID} |`, ...values);
  },
  info(...values) {
    console.info(`${MODULE_ID} |`, ...values);
  },
  warn(...values) {
    console.warn(`${MODULE_ID} |`, ...values);
  },
  error(...values) {
    console.error(`${MODULE_ID} |`, ...values);
  },
});

export function reportError(operation, error, { notify = true } = {}) {
  logger.error(operation, error);
  if (!notify) return;

  let message = `${MODULE_ID}: ${operation} failed. See the console for details.`;
  try {
    const key = translationKey("Errors.Operation");
    const localized = globalThis.game?.i18n?.format?.(key, { operation });
    if (typeof localized === "string" && localized !== key) message = localized;
  } catch (localizationError) {
    logger.debug("Could not localize the error notification.", localizationError);
  }

  try {
    globalThis.ui?.notifications?.error?.(message);
  } catch (notificationError) {
    // Error reporting must not hide the original failure during early startup.
    logger.warn("Could not display the error notification.", notificationError);
  }
}

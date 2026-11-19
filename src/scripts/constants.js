export const MODULE_ID = "foundryvtt-module-template";
export const MODULE_TITLE = "Foundry VTT Module Template";
export const MODULE_VERSION = "14.0.0";
export const MODULE_PATH = `modules/${MODULE_ID}`;

export function getModuleVersion() {
  return globalThis.game?.modules?.get(MODULE_ID)?.version ?? MODULE_VERSION;
}

export function translationKey(key) {
  return `${MODULE_ID}.${key}`;
}

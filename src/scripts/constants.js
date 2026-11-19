import manifest from "../module.json" with { type: "json" };

export const MODULE_ID = manifest.id;
export const MODULE_TITLE = manifest.title;
export const MODULE_VERSION = manifest.version;
export const MODULE_PATH = `modules/${MODULE_ID}`;

export function getModuleVersion() {
  return globalThis.game?.modules?.get(MODULE_ID)?.version ?? MODULE_VERSION;
}

export function translationKey(key) {
  return `${MODULE_ID}.${key}`;
}

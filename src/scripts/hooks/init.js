import { moduleApi } from "../api.js";
import { registerModuleApi } from "../module-registry.js";
import { registerSettings } from "../settings.js";
import { registerSocketHandlers } from "../socket-handlers.js";

export function onInit() {
  registerModuleApi(moduleApi);
  registerSettings();
  registerSocketHandlers();
}

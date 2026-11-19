import { markModuleReady, moduleApi } from "../api.js";
import { MODULE_ID, MODULE_PATH } from "../constants.js";
import { registerModuleSocket } from "../module-registry.js";
import { moduleSocket } from "../socket.js";

export async function onReady() {
  await foundry.applications.handlebars.loadTemplates([`${MODULE_PATH}/templates/module-settings.hbs`]);
  moduleSocket.activate();
  try {
    registerModuleSocket(moduleSocket);
  } catch (error) {
    moduleSocket.deactivate();
    throw error;
  }
  markModuleReady();
  Hooks.callAll(`${MODULE_ID}.ready`, moduleApi);
}

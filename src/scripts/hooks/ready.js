import { markModuleReady, moduleApi } from "../api.js";
import { MODULE_ID, MODULE_PATH } from "../constants.js";

export async function onReady() {
  await foundry.applications.handlebars.loadTemplates([`${MODULE_PATH}/templates/demo.hbs`]);
  markModuleReady();
  Hooks.callAll(`${MODULE_ID}.ready`, moduleApi);
}

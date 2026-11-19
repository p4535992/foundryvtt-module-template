import { moduleApi } from "../api.js";
import { MODULE_ID } from "../constants.js";
import { registerHandlebarsHelpers } from "../handlebars.js";
import { registerSettings } from "../settings.js";

export function onInit() {
  const module = game.modules.get(MODULE_ID);
  if (!module) throw new Error(`Foundry did not register the ${MODULE_ID} module.`);

  module.api = moduleApi;
  registerSettings();
  registerHandlebarsHelpers();
}

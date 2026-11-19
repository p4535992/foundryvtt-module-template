import { MODULE_ID } from "./constants.js";

export function registerHandlebarsHelpers() {
  Handlebars.registerHelper(`${MODULE_ID}-uppercase`, (value) => String(value ?? "").toUpperCase());
}

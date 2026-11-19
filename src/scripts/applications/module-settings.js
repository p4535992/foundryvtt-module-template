import { getModuleVersion, MODULE_ID, MODULE_PATH, MODULE_TITLE, translationKey } from "../constants.js";
import { reportError } from "../logger.js";
import { getDebugEnabled, setDebugEnabled } from "../settings.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** A reusable settings application for the module's client diagnostics. */
export class ModuleSettingsApplication extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-settings`,
    classes: [MODULE_ID],
    tag: "section",
    position: { width: 460, height: "auto" },
    window: { title: MODULE_TITLE, icon: "fa-solid fa-gears", resizable: false },
    actions: { toggleDebug: ModuleSettingsApplication.toggleDebug },
  };

  static PARTS = {
    content: { template: `${MODULE_PATH}/templates/module-settings.hbs` },
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const enabled = getDebugEnabled();
    return {
      ...context,
      moduleTitle: MODULE_TITLE,
      version: getModuleVersion(),
      icon: `${MODULE_PATH}/assets/module-icon.svg`,
      enabled,
      labels: {
        title: translationKey("Application.Title"),
        description: translationKey("Application.Description"),
        setting: translationKey("Application.DebugLabel"),
        status: translationKey(enabled ? "Application.Enabled" : "Application.Disabled"),
        toggle: translationKey(enabled ? "Application.DisableDebug" : "Application.EnableDebug"),
        note: translationKey("Application.Note"),
      },
    };
  }

  static async toggleDebug(event, target) {
    event.preventDefault();
    target.disabled = true;
    try {
      await setDebugEnabled(!getDebugEnabled());
      await this.render({ force: false });
    } catch (error) {
      reportError("Updating debug logging", error);
    } finally {
      target.disabled = false;
    }
  }
}

import { getModuleVersion, MODULE_ID, MODULE_PATH, MODULE_TITLE, translationKey } from "../constants.js";
import { reportError } from "../logger.js";
import { getSampleEnabled, setSampleEnabled } from "../settings.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ModuleDemoApplication extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-demo`,
    classes: [MODULE_ID],
    tag: "section",
    position: { width: 460, height: "auto" },
    window: {
      title: translationKey("Demo.Title"),
      icon: "fa-solid fa-cubes",
      resizable: false,
    },
    actions: {
      toggleSample: ModuleDemoApplication.toggleSample,
    },
  };

  static PARTS = {
    content: {
      template: `${MODULE_PATH}/templates/demo.hbs`,
    },
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const enabled = getSampleEnabled();
    return {
      ...context,
      moduleTitle: MODULE_TITLE,
      version: getModuleVersion(),
      icon: `${MODULE_PATH}/assets/module-icon.svg`,
      enabled,
      labels: {
        title: translationKey("Demo.Title"),
        description: translationKey("Demo.Description"),
        setting: translationKey("Demo.SettingLabel"),
        status: translationKey(enabled ? "Demo.Enabled" : "Demo.Disabled"),
        toggle: translationKey(enabled ? "Demo.Disable" : "Demo.Enable"),
        note: translationKey("Demo.Note"),
      },
    };
  }

  static async toggleSample(event, target) {
    event.preventDefault();
    target.disabled = true;
    try {
      await setSampleEnabled(!getSampleEnabled());
      await this.render({ force: false });
    } catch (error) {
      reportError("Updating the sample setting", error);
    } finally {
      target.disabled = false;
    }
  }
}

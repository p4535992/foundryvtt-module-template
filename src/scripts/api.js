import { getModuleVersion, MODULE_ID, MODULE_TITLE } from "./constants.js";
import { moduleSocket } from "./socket.js";

/** The public interface registered at game.modules.get(MODULE_ID).api. */
export class ModuleApi {
  #status = "initializing";
  #error = null;
  #whenReady;
  #resolveReady;
  #rejectReady;
  #opening = null;
  #openApplication;
  #socket;

  constructor({ openApplication = openModuleSettings, socket = moduleSocket } = {}) {
    this.#openApplication = openApplication;
    this.#socket = socket;
    this.#whenReady = new Promise((resolve, reject) => {
      this.#resolveReady = resolve;
      this.#rejectReady = reject;
    });
    // Startup reports failures even when no external consumer is waiting yet.
    void this.#whenReady.catch(() => {});
  }

  get id() {
    return MODULE_ID;
  }

  get title() {
    return MODULE_TITLE;
  }

  get version() {
    return getModuleVersion();
  }

  get ready() {
    return this.#status === "ready";
  }

  get status() {
    return this.#status;
  }

  get error() {
    return this.#error;
  }

  get whenReady() {
    return this.#whenReady;
  }

  get socket() {
    return this.#socket;
  }

  getStatus() {
    return {
      id: this.id,
      title: this.title,
      version: this.version,
      ready: this.ready,
      status: this.status,
      socketActive: this.#socket?.active ?? false,
      socketProvider: this.#socket?.active ? this.#socket.provider : null,
    };
  }

  async open() {
    await this.#whenReady;
    this.#opening ??= Promise.resolve().then(this.#openApplication);
    const operation = this.#opening;
    try {
      return await operation;
    } finally {
      if (this.#opening === operation) this.#opening = null;
    }
  }

  openSettings() {
    return this.open();
  }

  /** @internal Called by the module lifecycle after all services are ready. */
  _markReady() {
    if (this.#status !== "initializing") return;
    this.#status = "ready";
    this.#resolveReady(this);
  }

  /** @internal Preserve the original startup failure for API consumers. */
  _failInitialization(error) {
    if (this.#status !== "initializing") return;
    this.#error = error instanceof Error ? error : new Error(String(error));
    this.#status = "failed";
    this.#rejectReady(this.#error);
  }
}

let settingsApplication;

async function openModuleSettings() {
  if (!settingsApplication) {
    const { ModuleSettingsApplication } = await import("./applications/module-settings.js");
    settingsApplication = new ModuleSettingsApplication();
  }
  await settingsApplication.render({ force: true });
  return settingsApplication;
}

export const moduleApi = new ModuleApi();
export const markModuleReady = () => moduleApi._markReady();
export const failModuleInitialization = (error) => moduleApi._failInitialization(error);

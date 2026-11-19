import { getModuleVersion, MODULE_ID } from "./constants.js";

/**
 * Keep readiness separate from Foundry's ready event: template loading can finish
 * after that event has been dispatched to other modules.
 */
export function createApiController(openApplication) {
  let status = "initializing";
  let initializationError = null;
  let resolveReady;
  let rejectReady;
  let opening = null;

  const whenReady = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  // Bootstrap reports the failure. Consumers still receive the original rejection
  // when awaiting whenReady or open(), even if no consumer existed at failure time.
  void whenReady.catch(() => {});

  const api = Object.freeze({
    id: MODULE_ID,
    get version() {
      return getModuleVersion();
    },
    get ready() {
      return status === "ready";
    },
    get status() {
      return status;
    },
    get error() {
      return initializationError;
    },
    whenReady,
    async open() {
      await whenReady;
      opening ??= Promise.resolve().then(openApplication);
      const operation = opening;
      try {
        return await operation;
      } finally {
        if (opening === operation) opening = null;
      }
    },
  });

  return {
    api,
    markReady() {
      if (status !== "initializing") return;
      status = "ready";
      resolveReady(api);
    },
    fail(error) {
      if (status !== "initializing") return;
      initializationError = error instanceof Error ? error : new Error(String(error));
      status = "failed";
      rejectReady(initializationError);
    },
  };
}

let demoApplication;

async function openDemoApplication() {
  if (!demoApplication) {
    const { ModuleDemoApplication } = await import("./applications/module-demo.js");
    demoApplication = new ModuleDemoApplication();
  }
  await demoApplication.render({ force: true });
  return demoApplication;
}

const controller = createApiController(openDemoApplication);

export const moduleApi = controller.api;
export const markModuleReady = controller.markReady;
export const failModuleInitialization = controller.fail;

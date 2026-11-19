import { MODULE_ID } from "./constants.js";

function getModule() {
  const module = globalThis.game?.modules?.get(MODULE_ID);
  if (!module) throw new Error(`Foundry did not register the ${MODULE_ID} module.`);
  return module;
}

export function registerModuleApi(api) {
  const module = getModule();
  module.api = api;
  return module;
}

/**
 * Preserve the manifest's BooleanField source while exposing the required runtime
 * alias. The canonical service remains available through module.api.socket.
 */
export function registerModuleSocket(socket) {
  const module = getModule();
  if (!socket?.active) throw new Error("The module socket must be active before it is exposed.");
  const descriptor = Object.getOwnPropertyDescriptor(module, "socket");
  if (descriptor && "value" in descriptor && descriptor.value === socket) return () => {};
  if (!descriptor || !("value" in descriptor) || !descriptor.writable || typeof descriptor.value !== "boolean") {
    throw new Error("Foundry's module socket field cannot safely expose the runtime service on this build.");
  }
  if (typeof module.toObject !== "function" || typeof module.toJSON !== "function") {
    throw new Error("Foundry's module manifest serialization is unavailable.");
  }
  const flag = module.toObject(true).socket;
  if (typeof flag !== "boolean" || module.toJSON().socket !== flag) {
    throw new Error("The module manifest must preserve its boolean socket flag.");
  }

  const restore = () => {
    const current = Object.getOwnPropertyDescriptor(module, "socket");
    if (
      current &&
      "value" in current &&
      current.value === socket &&
      current.writable === descriptor.writable &&
      current.enumerable === descriptor.enumerable &&
      current.configurable === descriptor.configurable
    )
      Object.defineProperty(module, "socket", descriptor);
  };
  Object.defineProperty(module, "socket", { ...descriptor, value: socket });
  try {
    if (module.toObject(true).socket !== flag || module.toJSON().socket !== flag) {
      throw new Error("The runtime socket service must not change the serialized module manifest.");
    }
  } catch (error) {
    restore();
    throw error;
  }
  return restore;
}

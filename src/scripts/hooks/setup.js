import { initializeSettings } from "../settings.js";
import { registerConfiguredWrappers } from "../wrappers.js";

export function onSetup() {
  initializeSettings();
  registerConfiguredWrappers();
}

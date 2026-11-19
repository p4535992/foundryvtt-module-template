import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));

export function readManifest(projectRoot = PROJECT_ROOT) {
  const file = path.join(projectRoot, "src", "module.json");
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!manifest || !/^[a-z][a-z0-9-]*$/.test(manifest.id ?? "")) {
    throw new Error("src/module.json must have a lowercase module id containing letters, numbers, and hyphens.");
  }
  return manifest;
}

export function getModuleDirectory(base = "dist", projectRoot = PROJECT_ROOT) {
  return path.resolve(projectRoot, base, readManifest(projectRoot).id);
}

export function readFoundryConfig({ optional = false, projectRoot = PROJECT_ROOT } = {}) {
  const file = path.join(projectRoot, "foundryconfig.json");
  if (!fs.existsSync(file)) {
    if (optional) return {};
    throw new Error("Create foundryconfig.json from foundryconfig.example.json and configure your local Foundry paths.");
  }
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("foundryconfig.json must contain a JSON object.");
  }
  return config;
}

export function getFoundryDataDirectory(config) {
  if (typeof config.dataPath !== "string" || !path.isAbsolute(config.dataPath)) {
    throw new Error("foundryconfig.json dataPath must be an absolute path to your Foundry Data directory.");
  }
  const directory = path.resolve(config.dataPath);
  if (path.basename(directory) !== "Data" || !fs.statSync(directory, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`Foundry Data directory does not exist: ${directory}`);
  }
  return directory;
}

export function isMain(importMetaUrl) {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(importMetaUrl);
}

export function reportError(error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

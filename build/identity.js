import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PROJECT_ROOT, readManifest } from "./config.js";
import { parseReleaseTag } from "./verify-package.js";

export const LANGUAGE_NAMESPACE = "__MODULE_ID__";

function requireIdentity(condition, message) {
  if (!condition) throw new Error(message);
}

export async function validateProjectIdentity({ projectRoot = PROJECT_ROOT } = {}) {
  const manifest = readManifest(projectRoot);
  const packageJson = JSON.parse(await fs.readFile(path.join(projectRoot, "package.json"), "utf8"));
  requireIdentity(
    typeof manifest.title === "string" && manifest.title.trim().length > 0,
    "src/module.json title must be a nonempty string.",
  );
  parseReleaseTag(manifest.version);
  requireIdentity(packageJson.name === manifest.id, "package.json name must match src/module.json id.");
  requireIdentity(packageJson.version === manifest.version, "package.json version must match src/module.json version.");
  requireIdentity(packageJson.type === "module", "package.json must declare type: module.");
  requireIdentity(packageJson.main === "module.js", "package.json main must be module.js.");
  requireIdentity(
    packageJson.license === "SEE LICENSE IN LICENSE",
    "package.json license must be SEE LICENSE IN LICENSE.",
  );

  const filename = path.join(projectRoot, "src", "scripts", "constants.js");
  const source = await fs.readFile(filename);
  const url = pathToFileURL(filename);
  // The trusted constants module has no Foundry side effects. A content key keeps
  // repeated validation accurate after a local rename in the same Node process.
  url.searchParams.set("identity", createHash("sha256").update(source).digest("hex"));
  const constants = await import(url.href);
  for (const [name, field] of [
    ["MODULE_ID", "id"],
    ["MODULE_TITLE", "title"],
    ["MODULE_VERSION", "version"],
  ]) {
    requireIdentity(
      constants[name] === manifest[field],
      `src/scripts/constants.js ${name} must match src/module.json ${field}.`,
    );
  }
  requireIdentity(
    constants.MODULE_PATH === `modules/${manifest.id}`,
    "src/scripts/constants.js MODULE_PATH must derive from MODULE_ID.",
  );
  return { manifest, packageJson, constants };
}

export function renderLanguageSource(bytes, { moduleId, filename = "Language source" }) {
  requireIdentity(/^[a-z][a-z0-9-]*$/u.test(moduleId), "A valid module ID is required to render translations.");
  const translations = JSON.parse(bytes.toString("utf8"));
  requireIdentity(
    translations &&
      typeof translations === "object" &&
      !Array.isArray(translations) &&
      Object.keys(translations).length === 1 &&
      Object.hasOwn(translations, LANGUAGE_NAMESPACE),
    `${filename} must contain only the ${LANGUAGE_NAMESPACE} root namespace.`,
  );
  const contents = translations[LANGUAGE_NAMESPACE];
  requireIdentity(
    contents && typeof contents === "object" && !Array.isArray(contents),
    `${filename} ${LANGUAGE_NAMESPACE} must be an object.`,
  );
  return Buffer.from(`${JSON.stringify({ [moduleId]: contents }, null, 2)}\n`);
}

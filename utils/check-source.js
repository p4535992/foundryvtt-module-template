import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

async function collectFiles(directory) {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Source files must not be symbolic links: ${file}`);
    if (entry.isDirectory()) files.push(...(await collectFiles(file)));
    else if (entry.isFile()) files.push(file);
  }
  return files;
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function isRelativePath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !path.posix.isAbsolute(value) &&
    !value.includes("\\") &&
    !value.split("/").includes("..") &&
    !value.includes(":")
  );
}

function validateTranslations(value, file, prefix = "") {
  requireCondition(value && typeof value === "object" && !Array.isArray(value), `${file}: expected an object`);
  for (const [key, child] of Object.entries(value)) {
    const current = prefix ? `${prefix}.${key}` : key;
    requireCondition(!["__proto__", "prototype", "constructor"].includes(key), `${file}: unsafe key ${current}`);
    if (typeof child === "string") continue;
    requireCondition(
      child && typeof child === "object" && !Array.isArray(child),
      `${file}: ${current} must be a string or object`,
    );
    validateTranslations(child, file, current);
  }
}

async function main() {
  const sourceRoot = path.join(root, "src");
  const sourceFiles = await collectFiles(sourceRoot);
  const rootFiles = [
    "package.json",
    "jsconfig.json",
    ".prettierrc.json",
    "foundryconfig.example.json",
    "upstream.json",
  ].map((file) => path.join(root, file));
  const jsonFiles = [...rootFiles, ...sourceFiles.filter((file) => file.endsWith(".json"))];
  for (const file of jsonFiles) {
    try {
      JSON.parse(await fs.readFile(file, "utf8"));
    } catch (error) {
      throw new Error(`Invalid JSON in ${path.relative(root, file)}: ${error.message}`, { cause: error });
    }
  }

  const manifest = JSON.parse(await fs.readFile(path.join(sourceRoot, "module.json"), "utf8"));
  const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  requireCondition(
    /^[a-z][a-z0-9-]*$/.test(manifest.id),
    "The module ID must use lowercase letters, numbers, and hyphens.",
  );
  requireCondition(pkg.name === manifest.id, "package.json name must match src/module.json id.");
  requireCondition(pkg.version === manifest.version, "package.json version must match src/module.json version.");
  requireCondition(typeof manifest.title === "string" && manifest.title.trim(), "The module title is required.");
  requireCondition(typeof manifest.version === "string" && manifest.version.trim(), "The module version is required.");
  requireCondition(pkg.type === "module", "package.json must declare type: module.");
  requireCondition(manifest.esmodules?.includes("module.js"), "The manifest must load module.js.");
  requireCondition(manifest.styles?.includes("styles/module.css"), "The manifest must load styles/module.css.");
  requireCondition(
    Array.isArray(manifest.languages) && manifest.languages.length > 0,
    "Declare at least one language.",
  );

  const languageCodes = new Set();
  for (const language of manifest.languages) {
    const canonical = Intl.getCanonicalLocales(language.lang)[0];
    requireCondition(!languageCodes.has(canonical), `Duplicate language: ${canonical}`);
    languageCodes.add(canonical);
    requireCondition(
      isRelativePath(language.path) && language.path.startsWith("lang/"),
      "Translation paths must be relative paths under lang/.",
    );
    const translations = JSON.parse(await fs.readFile(path.join(sourceRoot, language.path), "utf8"));
    requireCondition(
      Object.hasOwn(translations, manifest.id),
      `${language.path} must contain the module ID namespace.`,
    );
    validateTranslations(translations, language.path);
  }
  requireCondition(languageCodes.has("en"), "The template must include its English source language.");

  for (const file of sourceFiles) {
    requireCondition(
      !/\.(?:ts|mts|cts|tsx)$/.test(file),
      `Runtime source must be JavaScript: ${path.relative(root, file)}`,
    );
  }
  for (const dependency of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
    requireCondition(
      !/^(?:typescript|tsx|typescript-eslint|@typescript-eslint\/|@types\/|@dfreds\/foundry-types|@league-of-foundry-developers\/foundry-vtt-types|vite-plugin-checker)/.test(
        dependency,
      ),
      `Remove the TypeScript-only direct dependency: ${dependency}`,
    );
  }
  console.log(`Validated ${jsonFiles.length} JSON files and the JavaScript module source contract.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

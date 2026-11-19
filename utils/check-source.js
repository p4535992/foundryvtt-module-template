import fs from "node:fs/promises";
import path from "node:path";
import { PROJECT_ROOT, isMain, reportError } from "../build/config.js";
import { renderLanguageSource, validateProjectIdentity } from "../build/identity.js";

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

export async function checkSource({ projectRoot = PROJECT_ROOT } = {}) {
  const { manifest, packageJson: pkg } = await validateProjectIdentity({ projectRoot });
  const sourceRoot = path.join(projectRoot, "src");
  const sourceFiles = await collectFiles(sourceRoot);
  const rootFiles = [
    "package.json",
    "jsconfig.json",
    ".prettierrc.json",
    "foundryconfig.example.json",
    "upstream.json",
  ].map((file) => path.join(projectRoot, file));
  const existingRootFiles = [];
  for (const file of rootFiles) {
    try {
      await fs.access(file);
      existingRootFiles.push(file);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const jsonFiles = [...existingRootFiles, ...sourceFiles.filter((file) => file.endsWith(".json"))];
  for (const file of jsonFiles) {
    try {
      JSON.parse(await fs.readFile(file, "utf8"));
    } catch (error) {
      throw new Error(`Invalid JSON in ${path.relative(projectRoot, file)}: ${error.message}`, { cause: error });
    }
  }

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
    const bytes = await fs.readFile(path.join(sourceRoot, language.path));
    const translations = JSON.parse(bytes.toString("utf8"));
    renderLanguageSource(bytes, { moduleId: manifest.id, filename: language.path });
    validateTranslations(translations, language.path);
  }
  requireCondition(languageCodes.has("en"), "The template must include its English source language.");

  for (const file of sourceFiles) {
    requireCondition(
      !/\.(?:ts|mts|cts|tsx)$/.test(file),
      `Runtime source must be JavaScript: ${path.relative(projectRoot, file)}`,
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
  return { moduleId: manifest.id, jsonFileCount: jsonFiles.length };
}

async function main() {
  const result = await checkSource();
  console.log(`Validated ${result.jsonFileCount} JSON files and the JavaScript module source contract.`);
}

if (isMain(import.meta.url)) void main().catch(reportError);

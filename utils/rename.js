import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { PROJECT_ROOT, isMain, readManifest, reportError } from "../build/config.js";

const TEXT_EXTENSIONS = new Set([".js", ".json", ".css", ".scss", ".hbs", ".html", ".md", ".txt"]);
const ROOT_FILES = [
  "package.json",
  "package-lock.json",
  "README.md",
  "CHANGELOG.md",
  "vite.config.js",
  "eslint.config.js",
  "jsconfig.json",
  "foundryconfig.example.json",
  ".gitignore",
];

function repositoryUrl(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("--repository must not be empty.");
  const input = value.trim();
  const normalized = (input.startsWith("https://") ? input : `https://github.com/${input}`)
    .replace(/\.git\/?$/, "")
    .replace(/\/$/, "");
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalized)) {
    throw new Error("--repository must be owner/repository or an https://github.com/owner/repository URL.");
  }
  return normalized;
}

async function candidates(projectRoot) {
  const result = [];
  async function visit(directory) {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.name.startsWith(".") || file === path.join(projectRoot, "src", "assets")) continue;
      if (entry.isSymbolicLink()) throw new Error(`Refusing to rename through a symbolic link: ${file}`);
      if (entry.isDirectory()) await visit(file);
      else if (TEXT_EXTENSIONS.has(path.extname(file))) result.push(file);
    }
  }
  for (const directory of ["src", "build", "utils", "wiki"]) await visit(path.join(projectRoot, directory));
  for (const name of ROOT_FILES) {
    const file = path.join(projectRoot, name);
    const stat = await fs.lstat(file).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (stat?.isSymbolicLink()) throw new Error(`Refusing to rename through a symbolic link: ${file}`);
    if (stat?.isFile()) result.push(file);
  }
  return [...new Set(result)];
}

export async function planRename({ projectRoot = PROJECT_ROOT, id, title, description, repository } = {}) {
  const manifest = readManifest(projectRoot);
  if (id !== undefined && !/^[a-z][a-z0-9-]*$/.test(id))
    throw new Error("--id must use lowercase letters, numbers, and hyphens, starting with a letter.");
  if (title !== undefined && (typeof title !== "string" || !title.trim() || /[\r\n]/.test(title)))
    throw new Error("--title must be a nonempty, single-line title.");
  if ([id, title, description, repository].every((value) => value === undefined))
    throw new Error("Provide --id, --title, --description, or --repository.");
  const newId = id ?? manifest.id;
  const oldRepository =
    typeof manifest.url === "string" && /^https:\/\/github\.com\/[^/]+\/[^/]+\/?$/.test(manifest.url)
      ? manifest.url.replace(/\/$/, "")
      : null;
  const newRepository = repository !== undefined ? repositoryUrl(repository) : oldRepository;
  const token = `__REPOSITORY_${randomUUID()}__`;

  function replaceText(value, humanText) {
    let result = value;
    if (oldRepository) result = result.replaceAll(oldRepository, token);
    result = result.replaceAll(manifest.id, newId);
    if (humanText && title !== undefined && manifest.title) result = result.replaceAll(manifest.title, title.trim());
    if (humanText && description !== undefined && manifest.description)
      result = result.replaceAll(manifest.description, description);
    if (oldRepository) result = result.replaceAll(token, newRepository ?? oldRepository);
    return result;
  }

  function replaceJson(value) {
    if (typeof value === "string") return replaceText(value, true);
    if (Array.isArray(value)) return value.map(replaceJson);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [replaceText(key, false), replaceJson(item)]),
      );
    return value;
  }

  const changes = [];
  for (const file of await candidates(projectRoot)) {
    const before = await fs.readFile(file, "utf8");
    const relative = path.relative(projectRoot, file).split(path.sep).join("/");
    let after;
    if (path.extname(file) === ".json") {
      const original = JSON.parse(before);
      const data = replaceJson(original);
      if (relative === "src/module.json") {
        data.id = newId;
        if (title !== undefined) data.title = title.trim();
        if (description !== undefined) data.description = description;
        if (repository) {
          data.url = newRepository;
          data.manifest = `${newRepository}/releases/latest/download/module.json`;
          data.download = `${newRepository}/releases/download/${data.version}/module.zip`;
          if (data.bugs) data.bugs = `${newRepository}/issues`;
          if (data.changelog) data.changelog = `${newRepository}/releases`;
        }
      }
      if (relative === "package.json") {
        data.name = newId;
        if (description !== undefined) data.description = description;
        if (repository) data.repository = { type: "git", url: `${newRepository}.git` };
      }
      if (relative === "package-lock.json") {
        data.name = newId;
        if (data.packages?.[""]) data.packages[""].name = newId;
      }
      after = JSON.stringify(original) === JSON.stringify(data) ? before : `${JSON.stringify(data, null, 2)}\n`;
    } else {
      after = replaceText(before, [".md", ".txt"].includes(path.extname(file)));
    }
    if (after !== before) changes.push({ file, relative, before, after });
  }
  return changes;
}

export async function renameModule(options = {}) {
  const changes = await planRename(options);
  if (options.dryRun) return changes.map((change) => change.relative);
  const staged = [];
  try {
    for (const change of changes) {
      if ((await fs.readFile(change.file, "utf8")) !== change.before)
        throw new Error(`A file changed while planning the rename: ${change.relative}`);
      const temporary = `${change.file}.rename-${randomUUID()}.tmp`;
      await fs.writeFile(temporary, change.after, { flag: "wx" });
      staged.push({ ...change, temporary });
    }
    const applied = [];
    try {
      for (const change of staged) {
        await fs.rename(change.temporary, change.file);
        applied.push(change);
      }
    } catch (error) {
      for (const change of applied) await fs.writeFile(change.file, change.before);
      throw error;
    }
  } finally {
    for (const change of staged) await fs.rm(change.temporary, { force: true });
  }
  return changes.map((change) => change.relative);
}

async function main() {
  const { values } = parseArgs({
    options: {
      id: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      repository: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    console.log(
      'Usage: npm run rename-module -- [--id my-module] [--title "My Module"] [--description "Description"] [--repository owner/repository] [--dry-run]',
    );
    console.log(
      "Updates local text files only. Assets, generated builds, and existing Foundry links are left untouched.",
    );
    return;
  }
  const changes = await renameModule({ ...values, dryRun: values["dry-run"] });
  console.log(`${values["dry-run"] ? "Would update" : "Updated"} ${changes.length} text files.`);
  for (const file of changes) console.log(`  ${file}`);
  if (!values["dry-run"] && changes.length)
    console.log("Rebuild and link the renamed module. Existing output directories and Foundry links are unchanged.");
}

if (isMain(import.meta.url)) await main().catch(reportError);

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { PROJECT_ROOT, isMain, reportError } from "../build/config.js";
import { parseReleaseTag, releaseUrls } from "../build/verify-package.js";

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

async function readIdentityFile(projectRoot, relative, { optional = false } = {}) {
  const file = path.join(projectRoot, relative);
  let stat;
  try {
    stat = await fs.lstat(file);
  } catch (error) {
    if (optional && error.code === "ENOENT") return null;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Identity file must be a regular file: ${relative}`);
  return { file, relative, before: await fs.readFile(file, "utf8") };
}

function updateLiteralConstants(source, values) {
  const pattern =
    /^export[ \t]+const[ \t]+(MODULE_ID|MODULE_TITLE|MODULE_VERSION)\s*=\s*("(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*')\s*;/gmu;
  const counts = new Map(Object.keys(values).map((name) => [name, 0]));
  for (const match of source.matchAll(pattern)) counts.set(match[1], counts.get(match[1]) + 1);
  for (const [name, count] of counts) {
    if (count !== 1) throw new Error(`constants.js must declare ${name} once as an exported string literal.`);
  }
  return source.replace(pattern, (_declaration, name) => `export const ${name} = ${JSON.stringify(values[name])};`);
}

function updateJsonFile(file, data) {
  return {
    ...file,
    after:
      JSON.stringify(JSON.parse(file.before)) === JSON.stringify(data)
        ? file.before
        : `${JSON.stringify(data, null, 2)}\n`,
  };
}

export async function planRename({ projectRoot = PROJECT_ROOT, id, title, description, version, repository } = {}) {
  if (id !== undefined && !/^[a-z][a-z0-9-]*$/.test(id))
    throw new Error("--id must use lowercase letters, numbers, and hyphens, starting with a letter.");
  if (title !== undefined && (typeof title !== "string" || !title.trim() || /[\r\n]/.test(title)))
    throw new Error("--title must be a nonempty, single-line title.");
  if (description !== undefined && typeof description !== "string") throw new Error("--description must be a string.");
  if ([id, title, description, version, repository].every((value) => value === undefined))
    throw new Error("Provide --id, --title, --description, --version, or --repository.");

  const [manifestFile, packageFile, constantsFile, lockFile] = await Promise.all([
    readIdentityFile(projectRoot, "src/module.json"),
    readIdentityFile(projectRoot, "package.json"),
    readIdentityFile(projectRoot, "src/scripts/constants.js"),
    readIdentityFile(projectRoot, "package-lock.json", { optional: true }),
  ]);
  const manifest = JSON.parse(manifestFile.before);
  const packageJson = JSON.parse(packageFile.before);
  const newId = id ?? manifest.id;
  if (!/^[a-z][a-z0-9-]*$/.test(newId)) throw new Error("The current module ID is invalid.");
  const newTitle = title?.trim() ?? manifest.title;
  if (typeof newTitle !== "string" || !newTitle.trim()) throw new Error("The module title must be a nonempty string.");
  const newVersion = parseReleaseTag(version ?? manifest.version).version;
  manifest.id = newId;
  manifest.title = newTitle;
  manifest.version = newVersion;
  packageJson.name = newId;
  packageJson.version = newVersion;
  if (description !== undefined) {
    manifest.description = description;
    packageJson.description = description;
  }
  const currentRepository =
    typeof manifest.url === "string" && /^https:\/\/github\.com\/[^/]+\/[^/]+\/?$/.test(manifest.url)
      ? manifest.url.replace(/\/$/, "")
      : null;
  const newRepository = repository === undefined ? currentRepository : repositoryUrl(repository);
  if (newRepository && (repository !== undefined || version !== undefined)) {
    const urls = releaseUrls(newRepository.slice("https://github.com/".length), newVersion);
    manifest.url = urls.repositoryUrl;
    manifest.manifest = urls.manifest;
    manifest.download = urls.download;
    if (Object.hasOwn(manifest, "bugs")) manifest.bugs = `${newRepository}/issues`;
    if (Object.hasOwn(manifest, "changelog")) manifest.changelog = `${newRepository}/releases`;
  }
  if (repository !== undefined) {
    packageJson.repository = { type: "git", url: `git+${newRepository}.git` };
    packageJson.homepage = `${newRepository}#readme`;
    packageJson.bugs = { url: `${newRepository}/issues` };
  }

  const changes = [
    updateJsonFile(manifestFile, manifest),
    updateJsonFile(packageFile, packageJson),
    {
      ...constantsFile,
      after: updateLiteralConstants(constantsFile.before, {
        MODULE_ID: newId,
        MODULE_TITLE: newTitle,
        MODULE_VERSION: newVersion,
      }),
    },
  ];
  if (lockFile) {
    const lock = JSON.parse(lockFile.before);
    lock.name = newId;
    lock.version = newVersion;
    if (lock.packages?.[""]) {
      lock.packages[""].name = newId;
      lock.packages[""].version = newVersion;
      if (packageJson.license !== undefined) lock.packages[""].license = packageJson.license;
    }
    changes.push(updateJsonFile(lockFile, lock));
  }
  return changes.filter((change) => change.after !== change.before);
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
      version: { type: "string" },
      repository: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    console.log(
      'Usage: npm run rename-module -- [--id my-module] [--title "My Module"] [--description "Description"] [--version 1.0.0] [--repository owner/repository] [--dry-run]',
    );
    console.log(
      "Updates src/module.json, package.json, and src/scripts/constants.js, plus generated package-lock.json root metadata.",
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

import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { PROJECT_ROOT, getModuleDirectory, isMain, readManifest, reportError } from "../build/config.js";

async function statIfPresent(file) {
  try {
    return await fs.lstat(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function prepareModuleDirectory({ outRoot = "dist", projectRoot = PROJECT_ROOT } = {}) {
  const { id } = readManifest(projectRoot);
  const parent = path.resolve(projectRoot, outRoot);
  const directory = getModuleDirectory(outRoot, projectRoot);
  const marker = path.join(parent, `.${id}.build.json`);
  const parentStat = await statIfPresent(parent);
  if (parentStat && (!parentStat.isDirectory() || parentStat.isSymbolicLink())) {
    throw new Error(`Build output root must be a real directory: ${parent}`);
  }
  const directoryStat = await statIfPresent(directory);
  if (directoryStat && (!directoryStat.isDirectory() || directoryStat.isSymbolicLink())) {
    throw new Error(`Refusing to build into a file or symbolic link: ${directory}`);
  }
  const markerStat = await statIfPresent(marker);
  if (markerStat?.isSymbolicLink()) throw new Error(`Refusing to follow build marker link: ${marker}`);
  if (markerStat) {
    const ownership = JSON.parse(await fs.readFile(marker, "utf8"));
    if (ownership.id !== id || ownership.directory !== directory || ownership.projectRoot !== projectRoot) {
      throw new Error(`Build ownership does not match this project: ${marker}`);
    }
  } else if (directoryStat && (await fs.readdir(directory)).length > 0) {
    throw new Error(`Refusing to replace an existing unowned directory: ${directory}. Choose an empty output root.`);
  }
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(marker, `${JSON.stringify({ id, directory, projectRoot }, null, 2)}\n`);
  return directory;
}

export async function cleanModuleDirectory({ outRoot = "dist", projectRoot = PROJECT_ROOT, preservePacks = true } = {}) {
  const directory = await prepareModuleDirectory({ outRoot, projectRoot });
  for (const entry of await fs.readdir(directory)) {
    if (preservePacks && entry === "packs") continue;
    await fs.rm(path.join(directory, entry), { recursive: true, force: true });
  }
  return directory;
}

async function main() {
  const { values } = parseArgs({ options: { "out-root": { type: "string", default: "dist" } } });
  const directory = await cleanModuleDirectory({ outRoot: values["out-root"] });
  console.log(`Cleaned generated files in ${directory}; compendium packs were preserved.`);
}

if (isMain(import.meta.url)) await main().catch(reportError);

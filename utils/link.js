import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { PROJECT_ROOT, getFoundryDataDirectory, getModuleDirectory, isMain, readFoundryConfig, readManifest, reportError } from "../build/config.js";

export async function linkModule({ projectRoot = PROJECT_ROOT, outRoot = "dist", config = readFoundryConfig({ projectRoot }) } = {}) {
  const { id } = readManifest(projectRoot);
  const target = getModuleDirectory(outRoot, projectRoot);
  const dataDirectory = getFoundryDataDirectory(config);
  if (!(await fs.stat(path.join(target, "module.json")).catch(() => null))?.isFile()) {
    throw new Error(`Build the module before linking it: ${target}`);
  }
  const modulesDirectory = path.join(dataDirectory, "modules");
  await fs.mkdir(modulesDirectory, { recursive: true });
  const linkPath = path.join(modulesDirectory, id);
  const existing = await fs.lstat(linkPath).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (existing) {
    if (!existing.isSymbolicLink()) {
      throw new Error(`Refusing to replace an existing file or directory: ${linkPath}`);
    }
    const linkedTarget = await fs.realpath(linkPath).catch(() => null);
    const realTarget = await fs.realpath(target);
    if (linkedTarget === realTarget) return { linkPath, target, created: false };
    throw new Error(`An existing link points elsewhere: ${linkPath}. Remove that link explicitly before linking this build.`);
  }
  await fs.symlink(target, linkPath, process.platform === "win32" ? "junction" : "dir");
  return { linkPath, target, created: true };
}

async function main() {
  const { values } = parseArgs({ options: { "out-root": { type: "string", default: "dist" } } });
  const result = await linkModule({ outRoot: values["out-root"] });
  console.log(`${result.created ? "Created" : "Already linked"}: ${result.linkPath} -> ${result.target}`);
}

if (isMain(import.meta.url)) await main().catch(reportError);

import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { PROJECT_ROOT, getModuleDirectory, isMain, readManifest, reportError } from "../build/config.js";
import { prepareModuleDirectory } from "./clean.js";

export function getPackJobs({ projectRoot = PROJECT_ROOT, outRoot = "dist", pack } = {}) {
  const manifest = readManifest(projectRoot);
  const seen = new Set();
  const seenPaths = new Set();
  const jobs = (manifest.packs ?? []).map((pack) => {
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(pack.name ?? "") || seen.has(pack.name)) {
      throw new Error(`Invalid or duplicate pack name: ${pack.name}`);
    }
    seen.add(pack.name);
    if (typeof pack.path !== "string" || !/^packs\/[a-z0-9][a-z0-9_-]*$/.test(pack.path)) {
      throw new Error(`Pack ${pack.name} must use a path such as packs/${pack.name}.`);
    }
    if (seenPaths.has(pack.path)) throw new Error(`Duplicate pack output path: ${pack.path}`);
    seenPaths.add(pack.path);
    return {
      name: pack.name,
      source: path.join(projectRoot, "packs-src", pack.name),
      destination: path.join(getModuleDirectory(outRoot, projectRoot), ...pack.path.split("/")),
    };
  });
  if (pack === undefined) return jobs;
  const selected = jobs.filter((job) => job.name === pack);
  if (selected.length === 0) throw new Error("Unknown declared pack: " + pack);
  return selected;
}

export async function runPacks({ action = "pack", projectRoot = PROJECT_ROOT, outRoot = "dist", pack, force = false, cli } = {}) {
  if (!["pack", "unpack"].includes(action)) throw new Error("Choose pack or unpack.");
  const jobs = getPackJobs({ projectRoot, outRoot, pack });
  if (jobs.length === 0) {
    console.log("No compendium packs are declared.");
    return;
  }
  for (const job of jobs) {
    const input = action === "pack" ? job.source : job.destination;
    const output = action === "pack" ? job.destination : job.source;
    const inputStat = await fs.lstat(input).catch(() => null);
    if (!inputStat?.isDirectory() || inputStat.isSymbolicLink()) throw new Error(`Missing pack input directory: ${input}`);
    const outputStat = await fs.lstat(output).catch(() => null);
    if (outputStat?.isSymbolicLink()) throw new Error(`Refusing to replace a pack link: ${output}`);
    if (outputStat && !force) {
      throw new Error(`Pack output already exists: ${output}. Close the Foundry world, preserve your changes, and pass --force to replace it.`);
    }
  }
  const { compilePack, extractPack } = cli ?? await import("@foundryvtt/foundryvtt-cli");
  if (action === "pack") await prepareModuleDirectory({ projectRoot, outRoot });
  for (const job of jobs) {
    try {
      if (action === "pack") {
        await fs.mkdir(path.dirname(job.destination), { recursive: true });
        await compilePack(job.source, job.destination, { recursive: true, log: true });
      } else {
        await fs.mkdir(path.dirname(job.source), { recursive: true });
        await extractPack(job.destination, job.source, { clean: true, omitVolatile: true, log: true });
      }
    } catch (error) {
      throw new Error(`Failed to ${action} ${job.name}: ${error.message}. Close any Foundry world using the pack before trying again.`, { cause: error });
    }
  }
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    "out-root": { type: "string", default: "dist" },
    pack: { type: "string" },
    force: { type: "boolean", default: false },
  } });
  if (positionals.length > 1) throw new Error("Usage: node utils/packs.js pack|unpack [--pack name] [--out-root path] [--force]");
  await runPacks({ action: positionals[0] ?? "pack", outRoot: values["out-root"], pack: values.pack, force: values.force });
}

if (isMain(import.meta.url)) await main().catch(reportError);

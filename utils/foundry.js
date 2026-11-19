import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import { getFoundryDataDirectory, isMain, readFoundryConfig, reportError } from "../build/config.js";

export function createFoundryLaunch(config, version = config.defaultVersion ?? "14") {
  const profile = config.versions?.[version];
  if (!profile || typeof profile !== "object") throw new Error(`Foundry version ${version} is not configured in foundryconfig.json.`);
  const dataDirectory = getFoundryDataDirectory({ ...config, dataPath: profile.dataPath ?? config.dataPath });
  const executable = profile.executable || process.execPath;
  if (typeof executable !== "string") throw new Error("The Foundry executable must be a string.");
  if ((executable.includes("/") || executable.includes("\\")) && !fs.statSync(executable, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`Configured executable does not exist: ${executable}`);
  }
  const args = [];
  if (profile.entry) {
    if (!path.isAbsolute(profile.entry) || !fs.statSync(profile.entry, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`Configured Foundry entry point does not exist: ${profile.entry}`);
    }
    args.push(profile.entry);
  } else if (!profile.executable) {
    throw new Error("Configure an entry point for Node or an explicit executable for the desktop application.");
  }
  if (profile.args && (!Array.isArray(profile.args) || profile.args.some((argument) => typeof argument !== "string"))) {
    throw new Error("Foundry profile args must be an array of strings.");
  }
  if ((profile.args ?? []).some((argument) => /^--dataPath(?:=|$)/i.test(argument))) {
    throw new Error("Set dataPath in the configuration instead of adding --dataPath to args.");
  }
  args.push(...(profile.args ?? []), `--dataPath=${path.dirname(dataDirectory)}`);
  return { executable, args, version };
}

export function startFoundry(config, version) {
  const launch = createFoundryLaunch(config, version);
  console.log(`Starting configured Foundry ${launch.version}.`);
  const child = spawn(launch.executable, launch.args, { stdio: "inherit", shell: false });
  return new Promise((resolve, reject) => {
    const forwardInterrupt = () => child.kill("SIGINT");
    const forwardTermination = () => child.kill("SIGTERM");
    const cleanup = () => {
      process.off("SIGINT", forwardInterrupt);
      process.off("SIGTERM", forwardTermination);
    };
    process.on("SIGINT", forwardInterrupt);
    process.on("SIGTERM", forwardTermination);
    child.once("error", (error) => { cleanup(); reject(error); });
    child.once("exit", (code, signal) => { cleanup(); resolve(code ?? (signal ? 1 : 0)); });
  });
}

async function main() {
  const { values } = parseArgs({ options: { version: { type: "string" } } });
  process.exitCode = await startFoundry(readFoundryConfig(), values.version);
}

if (isMain(import.meta.url)) await main().catch(reportError);

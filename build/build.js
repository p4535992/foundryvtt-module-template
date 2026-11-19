import fs from "node:fs/promises";
import { watch } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { PROJECT_ROOT, getModuleDirectory, isMain, readManifest, reportError } from "./config.js";
import { renderLanguageSource, validateProjectIdentity } from "./identity.js";
import { cleanModuleDirectory, prepareModuleDirectory } from "../utils/clean.js";

export const STATIC_DIRECTORIES = ["lang", "templates", "assets"];
const BUILD_MODES = new Set(["development", "stage", "production"]);

async function lstat(file) {
  try {
    return await fs.lstat(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function copyTree(source, destination, readBytes) {
  const sourceStat = await lstat(source);
  const destinationStat = await lstat(destination);
  if (sourceStat?.isSymbolicLink() || destinationStat?.isSymbolicLink()) {
    throw new Error(`Static resource links are not supported: ${source}`);
  }
  if (!sourceStat) {
    await fs.rm(destination, { recursive: true, force: true });
    return;
  }
  if (sourceStat.isFile()) {
    if (destinationStat?.isDirectory()) await fs.rm(destination, { recursive: true });
    await fs.mkdir(path.dirname(destination), { recursive: true });
    if (readBytes) await fs.writeFile(destination, await readBytes(source));
    else await fs.copyFile(source, destination);
    return;
  }
  if (!sourceStat.isDirectory()) throw new Error(`Unsupported static resource: ${source}`);
  if (destinationStat?.isFile()) await fs.rm(destination);
  await fs.mkdir(destination, { recursive: true });
  const names = (await fs.readdir(source)).filter((name) => !name.startsWith("."));
  const wanted = new Set(names);
  for (const existing of await fs.readdir(destination)) {
    if (!wanted.has(existing)) await fs.rm(path.join(destination, existing), { recursive: true, force: true });
  }
  for (const name of names) await copyTree(path.join(source, name), path.join(destination, name), readBytes);
}

export async function readStaticResource(file, { sourceRoot = path.join(PROJECT_ROOT, "src"), moduleId } = {}) {
  const bytes = await fs.readFile(file);
  const relative = path.relative(sourceRoot, file).split(path.sep).join("/");
  return relative.startsWith("lang/") && relative.endsWith(".json")
    ? renderLanguageSource(bytes, { moduleId, filename: relative })
    : bytes;
}

export function isStaticResource(file, sourceRoot = path.join(PROJECT_ROOT, "src")) {
  const relative = path.relative(sourceRoot, file);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return false;
  return relative === "module.json" || STATIC_DIRECTORIES.includes(relative.split(path.sep)[0]);
}

export async function syncStaticResources({
  sourceRoot = path.join(PROJECT_ROOT, "src"),
  targetRoot = getModuleDirectory(),
  expectedId,
} = {}) {
  const manifestFile = path.join(sourceRoot, "module.json");
  const manifest = JSON.parse(await fs.readFile(manifestFile, "utf8"));
  if (expectedId && manifest.id !== expectedId) {
    throw new Error("The module id changed. Stop the watcher, rebuild, and link the renamed module before restarting.");
  }
  await fs.mkdir(targetRoot, { recursive: true });
  await copyTree(manifestFile, path.join(targetRoot, "module.json"));
  for (const directory of STATIC_DIRECTORIES) {
    await copyTree(path.join(sourceRoot, directory), path.join(targetRoot, directory), (file) =>
      readStaticResource(file, { sourceRoot, moduleId: manifest.id }),
    );
  }
}

export function watchStaticResources({
  sourceRoot,
  targetRoot,
  expectedId,
  onChange = () => {},
  onError = reportError,
  debounce = 50,
}) {
  let timer;
  let closed = false;
  let queue = Promise.resolve();
  const watcher = watch(sourceRoot, { recursive: true }, (_event, filename) => {
    if (filename && !isStaticResource(path.join(sourceRoot, String(filename)), sourceRoot)) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (closed) return;
      queue = queue
        .then(async () => {
          if (closed) return;
          await syncStaticResources({ sourceRoot, targetRoot, expectedId });
          await onChange();
        })
        .catch(onError);
    }, debounce);
  });
  watcher.on("error", onError);
  return async () => {
    closed = true;
    clearTimeout(timer);
    watcher.close();
    await queue;
  };
}

const CONTENT_TYPES = {
  ".json": "application/json",
  ".hbs": "text/plain; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".css": "text/css; charset=utf-8",
};

export function createResourcesPlugin({
  projectRoot = PROJECT_ROOT,
  outRoot = "dist",
  mode = "production",
  watchMode = false,
}) {
  const { id } = readManifest(projectRoot);
  const sourceRoot = path.join(projectRoot, "src");
  const targetRoot = getModuleDirectory(outRoot, projectRoot);
  const moduleBase = `/modules/${id}/`;
  let stopWatching;
  return {
    name: "foundry-module-resources",
    async buildStart() {
      const { manifest } = await validateProjectIdentity({ projectRoot });
      if (manifest.id !== id) {
        throw new Error(
          "The module id changed. Stop the watcher, rebuild, and link the renamed module before restarting.",
        );
      }
      await prepareModuleDirectory({ outRoot, projectRoot });
    },
    async writeBundle() {
      await syncStaticResources({ sourceRoot, targetRoot, expectedId: id });
      for (const name of ["README.md", "CHANGELOG.md", "LICENSE", "THIRD_PARTY_NOTICES.md", "wiki"]) {
        await copyTree(path.join(projectRoot, name), path.join(targetRoot, name));
      }
      const lock = path.join(targetRoot, `${id}.lock`);
      if (mode === "production") await fs.rm(lock, { force: true });
      else await fs.writeFile(lock, "");
      if (watchMode && !stopWatching) {
        stopWatching = watchStaticResources({ sourceRoot, targetRoot, expectedId: id });
      }
    },
    async closeWatcher() {
      await stopWatching?.();
    },
    async configureServer(server) {
      const { manifest } = await validateProjectIdentity({ projectRoot });
      if (manifest.id !== id)
        throw new Error("The module id changed. Restart hot mode after rebuilding and linking it.");
      await prepareModuleDirectory({ outRoot, projectRoot });
      if (!(await lstat(path.join(targetRoot, "module.js")))?.isFile()) {
        throw new Error("Build and link the module before starting hot mode: npm run dev, then npm run link.");
      }
      await syncStaticResources({ sourceRoot, targetRoot, expectedId: id });
      stopWatching = watchStaticResources({
        sourceRoot,
        targetRoot,
        expectedId: id,
        onChange: () => server.ws.send({ type: "full-reload" }),
        onError: (error) => server.config.logger.error(error.message),
      });
      server.httpServer?.once("close", () => {
        void stopWatching?.();
      });
      server.middlewares.use(async (request, response, next) => {
        try {
          const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
          if (!pathname.startsWith(moduleBase)) return next();
          const relative = pathname.slice(moduleBase.length);
          if (relative === "module.js") {
            response.setHeader("Content-Type", "text/javascript; charset=utf-8");
            response.end(
              `import ${JSON.stringify(`${moduleBase}@vite/client`)};\nimport ${JSON.stringify(`${moduleBase}src/module.js`)};\n`,
            );
            return;
          }
          if (relative === "styles/module.css") {
            response.setHeader("Content-Type", "text/css; charset=utf-8");
            response.end("/* Development styles are injected by Vite. */\n");
            return;
          }
          const file = path.resolve(sourceRoot, relative);
          if (!isStaticResource(file, sourceRoot)) return next();
          const fileStat = await lstat(file);
          if (!fileStat?.isFile() || fileStat.isSymbolicLink()) return next();
          response.setHeader("Content-Type", CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream");
          response.setHeader("Cache-Control", "no-store");
          response.end(await readStaticResource(file, { sourceRoot, moduleId: id }));
        } catch (error) {
          next(error);
        }
      });
    },
    handleHotUpdate(context) {
      const relative = path.relative(sourceRoot, context.file);
      if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return;
      if (isStaticResource(context.file, sourceRoot)) return [];
      if (context.file.endsWith(".js")) {
        context.server.ws.send({ type: "full-reload" });
        return [];
      }
    },
  };
}

export async function runBuild({
  projectRoot = PROJECT_ROOT,
  outRoot = "dist",
  mode = "production",
  watchMode = false,
} = {}) {
  if (!BUILD_MODES.has(mode)) throw new Error(`Unsupported build mode: ${mode}`);
  await validateProjectIdentity({ projectRoot });
  // Import dependencies before cleaning a working build so a missing install is harmless.
  const [{ build }, { createModuleConfig }] = await Promise.all([import("vite"), import("../vite.config.js")]);
  await cleanModuleDirectory({ projectRoot, outRoot, preservePacks: true });
  const config = createModuleConfig({ projectRoot, command: "build", mode, outRoot, watchMode });
  const result = await build({ ...config, configFile: false, mode });
  if (watchMode && result && typeof result.close === "function") {
    for (const signal of ["SIGINT", "SIGTERM"]) {
      process.once(signal, () => {
        void result.close().catch(reportError);
      });
    }
    console.log("Watching JavaScript, styles, translations, templates, and assets. Reload Foundry after changes.");
  }
  return result;
}

async function main() {
  const { values } = parseArgs({
    options: {
      "out-root": { type: "string", default: "dist" },
      mode: { type: "string", default: "production" },
      watch: { type: "boolean", default: false },
    },
  });
  await runBuild({ outRoot: values["out-root"], mode: values.mode, watchMode: values.watch });
}

// Complete module evaluation before loading vite.config.js, which imports this plugin.
if (isMain(import.meta.url)) void main().catch(reportError);

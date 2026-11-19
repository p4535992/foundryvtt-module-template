import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { EventEmitter } from "node:events";
import { cleanModuleDirectory, prepareModuleDirectory } from "../utils/clean.js";
import { createResourcesPlugin, runBuild, syncStaticResources, watchStaticResources } from "../build/build.js";
import { PROJECT_ROOT, getModuleDirectory, readManifest } from "../build/config.js";
import { validateProjectIdentity } from "../build/identity.js";
import { checkSource } from "../utils/check-source.js";
import { linkModule } from "../utils/link.js";
import { createFoundryLaunch, startFoundry } from "../utils/foundry.js";
import { getPackJobs, runPacks } from "../utils/packs.js";
import { renameModule } from "../utils/rename.js";

async function write(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

async function exists(file) {
  return Boolean(await fs.stat(file).catch(() => null));
}

async function fixture(t) {
  const temporaryRoot = path.join(PROJECT_ROOT, ".test-tmp");
  await fs.mkdir(temporaryRoot, { recursive: true });
  const root = await fs.mkdtemp(path.join(temporaryRoot, "build-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const manifest = {
    id: "old-module",
    title: "Old Module",
    description: "Old description",
    version: "0.1.0",
    packs: [],
    url: "https://github.com/example/old-module",
    esmodules: ["module.js"],
    styles: ["styles/module.css"],
    languages: [{ lang: "en", name: "English", path: "lang/en.json" }],
  };
  await write(path.join(root, "src/module.json"), JSON.stringify(manifest));
  await write(
    path.join(root, "src/module.js"),
    'import "./styles/module.scss";\nexport { MODULE_ID } from "./scripts/constants.js";\n',
  );
  await write(
    path.join(root, "src/scripts/constants.js"),
    'export const MODULE_ID = "old-module";\nexport const MODULE_TITLE = "Old Module";\nexport const MODULE_VERSION = "0.1.0";\nexport const MODULE_PATH = `modules/${MODULE_ID}`;\n',
  );
  await write(path.join(root, "src/scripts/main.js"), 'export const prefix = "old-module";\n');
  await write(path.join(root, "src/styles/module.scss"), ".#{$module-id} { color: red; }\n");
  await write(
    path.join(root, "src/lang/en.json"),
    JSON.stringify({ __MODULE_ID__: { title: "Module settings", literal: "old-module __MODULE_ID__" } }),
  );
  await write(
    path.join(root, "src/templates/application.hbs"),
    '<section class="module-application">Unrelated old-module content</section>\n',
  );
  await write(path.join(root, "src/assets/image.png"), Buffer.from([0, 255, 128, ...Buffer.from("old-module"), 0]));
  await write(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "old-module",
      version: "0.1.0",
      description: "Old description",
      type: "module",
      main: "module.js",
      license: "SEE LICENSE IN LICENSE",
    }),
  );
  await write(
    path.join(root, "package-lock.json"),
    JSON.stringify({
      name: "old-module",
      version: "0.1.0",
      lockfileVersion: 3,
      packages: {
        "": { name: "old-module", version: "0.1.0", license: "SEE LICENSE IN LICENSE" },
        "node_modules/unrelated": { version: "1.0.0", description: "old-module" },
      },
    }),
  );
  await write(
    path.join(root, "upstream.json"),
    JSON.stringify({ repository: "DFreds/dfreds-module-template-ts", note: "old-module" }),
  );
  await write(path.join(root, "README.md"), "# Old Module\nOld description\nhttps://github.com/example/old-module\n");
  await write(path.join(root, "wiki/runtime.md"), "# Old Module runtime\n\nUse old-module.\n");
  await write(path.join(root, "utils/example-helper.js"), 'export const moduleId = "old-module";\n');
  await write(
    path.join(root, "CHANGELOG.md"),
    "# Changelog\n\n## [0.1.0] - 2026-11-19\n\n- Added Old Module (`old-module`).\n\n[0.1.0]: https://github.com/example/old-module/releases/tag/v0.1.0\n",
  );
  return root;
}

test("cleanup refuses an unowned directory without deleting its contents", async (t) => {
  const root = await fixture(t);
  const sentinel = path.join(root, "dist/old-module/keep.txt");
  await write(sentinel, "user data");
  await assert.rejects(cleanModuleDirectory({ projectRoot: root }), /unowned directory/);
  assert.equal(await fs.readFile(sentinel, "utf8"), "user data");
});

test("cleanup removes only managed module output and preserves live packs", async (t) => {
  const root = await fixture(t);
  const output = await prepareModuleDirectory({ projectRoot: root });
  await write(path.join(output, "module.js"), "stale");
  await write(path.join(output, "packs/demo/document.bin"), "live data");
  await write(path.join(root, "dist/unrelated/user.txt"), "unrelated");
  await cleanModuleDirectory({ projectRoot: root });
  assert.equal(await exists(path.join(output, "module.js")), false);
  assert.equal(await fs.readFile(path.join(output, "packs/demo/document.bin"), "utf8"), "live data");
  assert.equal(await fs.readFile(path.join(root, "dist/unrelated/user.txt"), "utf8"), "unrelated");
});

test("cleanup refuses a linked output directory", async (t) => {
  const root = await fixture(t);
  const actual = path.join(root, "user-data");
  await fs.mkdir(actual);
  await fs.mkdir(path.join(root, "dist"));
  await fs.symlink(actual, getModuleDirectory("dist", root), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(cleanModuleDirectory({ projectRoot: root }), /symbolic link/);
  assert.equal(await exists(actual), true);
});

test("static copying excludes source code and synchronizes additions and deletions", async (t) => {
  const root = await fixture(t);
  const sourceRoot = path.join(root, "src");
  const targetRoot = await prepareModuleDirectory({ projectRoot: root });
  await syncStaticResources({ sourceRoot, targetRoot, expectedId: "old-module" });
  assert.equal(await exists(path.join(targetRoot, "scripts")), false);
  assert.equal(await exists(path.join(targetRoot, "styles")), false);
  assert.deepEqual(
    await fs.readFile(path.join(targetRoot, "assets/image.png")),
    await fs.readFile(path.join(sourceRoot, "assets/image.png")),
  );
  await fs.rm(path.join(sourceRoot, "templates/application.hbs"));
  await write(path.join(sourceRoot, "templates/new/nested.hbs"), "New content");
  await write(path.join(sourceRoot, "lang/en.json"), '{"__MODULE_ID__":{"updated":"yes"}}');
  await syncStaticResources({ sourceRoot, targetRoot, expectedId: "old-module" });
  assert.equal(await exists(path.join(targetRoot, "templates/application.hbs")), false);
  assert.equal(await fs.readFile(path.join(targetRoot, "templates/new/nested.hbs"), "utf8"), "New content");
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(targetRoot, "lang/en.json"), "utf8")), {
    "old-module": { updated: "yes" },
  });
});

test("resource mirroring preserves Vite-generated assets in their separate namespace", async (t) => {
  const root = await fixture(t);
  const plugin = createResourcesPlugin({ projectRoot: root });
  await plugin.buildStart();
  const generated = path.join(root, "dist/old-module/scripts/generated-assets/imported-icon-hash.svg");
  await write(generated, "<svg></svg>");
  await plugin.writeBundle();
  assert.equal(await fs.readFile(generated, "utf8"), "<svg></svg>");
  assert.equal(await exists(path.join(root, "dist/old-module/assets/image.png")), true);
  assert.equal(
    await fs.readFile(path.join(root, "dist/old-module/CHANGELOG.md"), "utf8"),
    await fs.readFile(path.join(root, "CHANGELOG.md"), "utf8"),
  );
  assert.equal(
    await fs.readFile(path.join(root, "dist/old-module/wiki/runtime.md"), "utf8"),
    await fs.readFile(path.join(root, "wiki/runtime.md"), "utf8"),
  );
  assert.equal(await exists(path.join(root, "dist/old-module/docs")), false);
  assert.equal(await exists(path.join(root, "dist/old-module/utils")), false);
});

async function waitUntil(check) {
  const deadline = Date.now() + 4000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for a file watcher update.");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test("watcher copies newly created resources and removes deleted resources", async (t) => {
  const root = await fixture(t);
  const sourceRoot = path.join(root, "src");
  const targetRoot = await prepareModuleDirectory({ projectRoot: root });
  await syncStaticResources({ sourceRoot, targetRoot, expectedId: "old-module" });
  const errors = [];
  const close = watchStaticResources({
    sourceRoot,
    targetRoot,
    expectedId: "old-module",
    debounce: 10,
    onError: (error) => errors.push(error),
  });
  t.after(close);
  const file = path.join(sourceRoot, "templates/fresh.hbs");
  const copied = path.join(targetRoot, "templates/fresh.hbs");
  await write(file, "First");
  await waitUntil(() => exists(copied));
  await write(file, "Second");
  await waitUntil(async () => (await fs.readFile(copied, "utf8")) === "Second");
  await fs.rm(file);
  await waitUntil(async () => !(await exists(copied)));
  const language = path.join(sourceRoot, "lang/it.json");
  const copiedLanguage = path.join(targetRoot, "lang/it.json");
  await write(language, JSON.stringify({ __MODULE_ID__: { title: "First translation" } }));
  await waitUntil(() => exists(copiedLanguage));
  assert.deepEqual(JSON.parse(await fs.readFile(copiedLanguage, "utf8")), {
    "old-module": { title: "First translation" },
  });
  await write(language, JSON.stringify({ __MODULE_ID__: { title: "Updated translation" } }));
  await waitUntil(
    async () => JSON.parse(await fs.readFile(copiedLanguage, "utf8"))["old-module"].title === "Updated translation",
  );
  await fs.rm(language);
  await waitUntil(async () => !(await exists(copiedLanguage)));
  assert.deepEqual(errors, []);
});

test("renaming updates only identity files and generated lock metadata with safely escaped constants", async (t) => {
  const root = await fixture(t);
  await validateProjectIdentity({ projectRoot: root });
  const preserved = [
    "src/lang/en.json",
    "src/styles/module.scss",
    "src/templates/application.hbs",
    "src/scripts/main.js",
    "src/assets/image.png",
    "README.md",
    "CHANGELOG.md",
    "wiki/runtime.md",
    "utils/example-helper.js",
    "upstream.json",
  ];
  const before = new Map(
    await Promise.all(preserved.map(async (file) => [file, await fs.readFile(path.join(root, file))])),
  );
  const title = 'New "Module" \\ $& café';
  const description = "A description with $(), quotes, and café.";
  const changes = await renameModule({
    projectRoot: root,
    id: "new-module",
    title,
    description,
    version: "2.3.4-rc.1",
    repository: "another-owner/new-repository",
  });
  assert.deepEqual(changes.sort(), [
    "package-lock.json",
    "package.json",
    "src/module.json",
    "src/scripts/constants.js",
  ]);
  const { manifest, packageJson, constants } = await validateProjectIdentity({ projectRoot: root });
  assert.equal(manifest.id, "new-module");
  assert.equal(manifest.title, title);
  assert.equal(manifest.description, description);
  assert.equal(manifest.version, "2.3.4-rc.1");
  assert.equal(manifest.url, "https://github.com/another-owner/new-repository");
  assert.equal(
    manifest.download,
    "https://github.com/another-owner/new-repository/releases/download/2.3.4-rc.1/module.zip",
  );
  assert.equal(
    manifest.manifest,
    "https://github.com/another-owner/new-repository/releases/download/2.3.4-rc.1/module.json",
  );
  assert.equal(constants.MODULE_TITLE, title);
  assert.equal(constants.MODULE_ID, "new-module");
  assert.equal(packageJson.repository.url, "git+https://github.com/another-owner/new-repository.git");
  assert.equal(packageJson.homepage, "https://github.com/another-owner/new-repository#readme");
  assert.equal(packageJson.bugs.url, "https://github.com/another-owner/new-repository/issues");
  for (const [file, bytes] of before) assert.deepEqual(await fs.readFile(path.join(root, file)), bytes, file);
  const lock = JSON.parse(await fs.readFile(path.join(root, "package-lock.json"), "utf8"));
  assert.equal(lock.name, "new-module");
  assert.equal(lock.version, "2.3.4-rc.1");
  assert.equal(lock.packages[""].name, "new-module");
  assert.equal(lock.packages[""].version, "2.3.4-rc.1");
  assert.deepEqual(lock.packages["node_modules/unrelated"], { version: "1.0.0", description: "old-module" });
});

test("rename validation and dry run leave the project unchanged", async (t) => {
  const root = await fixture(t);
  const before = await fs.readFile(path.join(root, "src/module.json"), "utf8");
  await assert.rejects(renameModule({ projectRoot: root, id: "../outside" }), /--id/);
  await assert.rejects(renameModule({ projectRoot: root, version: "v1.0.0" }), /semantic version/);
  const changes = await renameModule({ projectRoot: root, id: "new-module", dryRun: true });
  assert.ok(changes.includes("src/module.json"));
  assert.equal(await fs.readFile(path.join(root, "src/module.json"), "utf8"), before);
  await renameModule({ projectRoot: root, id: "new-module" });
  assert.equal(readManifest(root).url, "https://github.com/example/old-module");
});

test("rename refuses computed constants before modifying any identity file", async (t) => {
  const root = await fixture(t);
  const constantsFile = path.join(root, "src/scripts/constants.js");
  const original = await fs.readFile(path.join(root, "src/module.json"));
  const source = await fs.readFile(constantsFile, "utf8");
  await fs.writeFile(constantsFile, source.replace('MODULE_TITLE = "Old Module"', 'MODULE_TITLE = "Old" + " Module"'));
  await assert.rejects(renameModule({ projectRoot: root, id: "new-module" }), /MODULE_TITLE.*string literal/);
  assert.deepEqual(await fs.readFile(path.join(root, "src/module.json")), original);
});

test("a copied template builds and serves matching translations after editing only its three identity files", async (t) => {
  const root = await fixture(t);
  const preserved = [
    "src/lang/en.json",
    "src/styles/module.scss",
    "src/templates/application.hbs",
    "src/assets/image.png",
  ];
  const originals = new Map(
    await Promise.all(preserved.map(async (file) => [file, await fs.readFile(path.join(root, file))])),
  );
  const manifest = { ...readManifest(root), id: "copied-module", title: "Copied Module", version: "2.0.0" };
  const packageJson = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  await fs.writeFile(path.join(root, "src/module.json"), JSON.stringify(manifest));
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ ...packageJson, name: manifest.id, version: manifest.version }),
  );
  await fs.writeFile(
    path.join(root, "src/scripts/constants.js"),
    [
      `export const MODULE_ID = ${JSON.stringify(manifest.id)};`,
      `export const MODULE_TITLE = ${JSON.stringify(manifest.title)};`,
      `export const MODULE_VERSION = ${JSON.stringify(manifest.version)};`,
      "export const MODULE_PATH = `modules/${MODULE_ID}`;",
      "",
    ].join("\n"),
  );

  assert.equal((await checkSource({ projectRoot: root })).moduleId, manifest.id);
  await runBuild({ projectRoot: root });
  const output = getModuleDirectory("dist", root);
  const builtLanguage = await fs.readFile(path.join(output, "lang/en.json"));
  assert.deepEqual(JSON.parse(builtLanguage.toString("utf8")), {
    "copied-module": { title: "Module settings", literal: "old-module __MODULE_ID__" },
  });
  const stylesheet = await fs.readFile(path.join(output, "styles/module.css"), "utf8");
  assert.match(stylesheet, /\.copied-module\s*\{/u);
  assert.doesNotMatch(stylesheet, /\.old-module\s*\{/u);
  for (const [file, bytes] of originals) assert.deepEqual(await fs.readFile(path.join(root, file)), bytes, file);

  const plugin = createResourcesPlugin({ projectRoot: root, mode: "development" });
  let middleware;
  const errors = [];
  await plugin.configureServer({
    httpServer: new EventEmitter(),
    middlewares: {
      use(handler) {
        middleware = handler;
      },
    },
    ws: { send() {} },
    config: {
      logger: {
        error(error) {
          errors.push(error);
        },
      },
    },
  });
  t.after(() => plugin.closeWatcher());
  let served;
  await middleware(
    { url: "/modules/copied-module/lang/en.json" },
    {
      setHeader() {},
      end(bytes) {
        served = bytes;
      },
    },
    (error) => {
      throw error ?? new Error("Language request fell through the module middleware.");
    },
  );
  assert.deepEqual(served, builtLanguage);
  assert.deepEqual(errors, []);
});

test("identity mismatches stop a build before cleaning an existing managed output", async (t) => {
  const root = await fixture(t);
  const output = await prepareModuleDirectory({ projectRoot: root });
  const sentinel = path.join(output, "module.js");
  await fs.writeFile(sentinel, "Keep the working build.\n");
  const filename = path.join(root, "src/scripts/constants.js");
  const source = await fs.readFile(filename, "utf8");
  await fs.writeFile(filename, source.replace('MODULE_ID = "old-module"', 'MODULE_ID = "different-module"'));
  await assert.rejects(runBuild({ projectRoot: root }), /MODULE_ID must match/);
  assert.equal(await fs.readFile(sentinel, "utf8"), "Keep the working build.\n");
});

test("a watcher configured for the old identity refuses to emit after the project is renamed", async (t) => {
  const root = await fixture(t);
  const plugin = createResourcesPlugin({ projectRoot: root, watchMode: true });
  await renameModule({ projectRoot: root, id: "new-module" });
  await assert.rejects(plugin.buildStart(), /module id changed.*Stop the watcher/u);
  assert.equal(await exists(path.join(root, "dist/new-module")), false);
});

async function linkFixture(t) {
  const root = await fixture(t);
  const output = await prepareModuleDirectory({ projectRoot: root });
  await write(path.join(output, "module.json"), JSON.stringify(readManifest(root)));
  const dataPath = path.join(root, "Foundry user data", "Data");
  await fs.mkdir(dataPath, { recursive: true });
  return { root, config: { dataPath } };
}

test("link is idempotent and refuses a real module directory", async (t) => {
  const { root, config } = await linkFixture(t);
  const first = await linkModule({ projectRoot: root, config });
  assert.equal(first.created, true);
  assert.equal((await linkModule({ projectRoot: root, config })).created, false);
  await fs.unlink(first.linkPath);
  await write(path.join(first.linkPath, "keep.txt"), "installed module");
  await assert.rejects(linkModule({ projectRoot: root, config }), /Refusing to replace/);
  assert.equal(await fs.readFile(path.join(first.linkPath, "keep.txt"), "utf8"), "installed module");
});

test("link refuses to silently repoint an existing link", async (t) => {
  const { root, config } = await linkFixture(t);
  const modules = path.join(config.dataPath, "modules");
  const elsewhere = path.join(root, "elsewhere");
  await fs.mkdir(modules);
  await fs.mkdir(elsewhere);
  const linkPath = path.join(modules, "old-module");
  await fs.symlink(elsewhere, linkPath, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(linkModule({ projectRoot: root, config }), /points elsewhere/);
  assert.equal(await fs.realpath(linkPath), await fs.realpath(elsewhere));
});

test("Foundry launcher preserves spaces and literal shell characters in arguments", async (t) => {
  const { root, config } = await linkFixture(t);
  const entry = path.join(root, "fake Foundry.mjs");
  const captured = path.join(root, "captured arguments.json");
  await write(
    entry,
    'import fs from "node:fs"; fs.writeFileSync(process.argv[2], JSON.stringify(process.argv.slice(3)));',
  );
  const fullConfig = {
    ...config,
    versions: { 14: { entry, args: [captured, "--literal=$(not-a-command); untouched"] } },
  };
  const launch = createFoundryLaunch(fullConfig, "14");
  assert.equal(launch.args[0], entry);
  assert.equal(await startFoundry(fullConfig, "14"), 0);
  assert.deepEqual(JSON.parse(await fs.readFile(captured, "utf8")), [
    "--literal=$(not-a-command); untouched",
    `--dataPath=${path.dirname(config.dataPath)}`,
  ]);
});

test("pack path validation prevents traversal and missing inputs fail before loading the CLI", async (t) => {
  const root = await fixture(t);
  const manifest = readManifest(root);
  manifest.packs = [{ name: "demo", path: "../outside" }];
  await write(path.join(root, "src/module.json"), JSON.stringify(manifest));
  assert.throws(() => getPackJobs({ projectRoot: root }), /must use a path/);
  manifest.packs[0].path = "packs/demo";
  await write(path.join(root, "src/module.json"), JSON.stringify(manifest));
  await assert.rejects(runPacks({ projectRoot: root }), /Missing pack input/);
});

test("pack compilation uses separate source/output paths and requires explicit overwrite", async (t) => {
  const root = await fixture(t);
  const manifest = readManifest(root);
  manifest.packs = [{ name: "demo", path: "packs/demo" }];
  await write(path.join(root, "src/module.json"), JSON.stringify(manifest));
  await write(path.join(root, "packs-src/demo/document.json"), '{"_id":"example"}');
  let calls = 0;
  const cli = {
    async compilePack(source, destination) {
      calls += 1;
      assert.equal(source, path.join(root, "packs-src/demo"));
      await write(path.join(destination, "CURRENT"), "fixture");
    },
  };
  await runPacks({ projectRoot: root, cli });
  assert.equal(calls, 1);
  await assert.rejects(runPacks({ projectRoot: root, cli }), /--force/);
  assert.equal(calls, 1);
  await cleanModuleDirectory({ projectRoot: root });
  assert.equal(await exists(path.join(root, "dist/old-module/packs/demo/CURRENT")), true);
});

test("single-pack selection leaves other packs alone and rejects unknown names", async (t) => {
  const root = await fixture(t);
  const manifest = readManifest(root);
  manifest.packs = [
    { name: "demo", path: "packs/demo" },
    { name: "other", path: "packs/other" },
  ];
  await write(path.join(root, "src/module.json"), JSON.stringify(manifest));
  await write(path.join(root, "packs-src/demo/document.json"), '{"_id":"example"}');
  const calls = [];
  const cli = {
    async compilePack(source, destination) {
      calls.push({ source, destination });
      await write(path.join(destination, "CURRENT"), "fixture");
    },
  };
  await runPacks({ projectRoot: root, pack: "demo", cli });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].source, path.join(root, "packs-src/demo"));
  assert.equal(await exists(path.join(root, "dist/old-module/packs/other")), false);
  assert.throws(() => getPackJobs({ projectRoot: root, pack: "unknown" }), /Unknown declared pack/);
  await assert.rejects(runPacks({ projectRoot: root, pack: "unknown", cli }), /Unknown declared pack/);
  assert.equal(calls.length, 1);
});

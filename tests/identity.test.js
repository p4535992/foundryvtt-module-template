import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { runBuild } from "../build/build.js";
import { PROJECT_ROOT } from "../build/config.js";
import { renderLanguageSource, validateProjectIdentity } from "../build/identity.js";

async function fixture(t, { constants = {}, packageJson = {} } = {}) {
  const parent = path.join(PROJECT_ROOT, ".test-tmp");
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, "identity-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "src", "scripts"), { recursive: true });
  await fs.writeFile(
    path.join(root, "src", "module.json"),
    JSON.stringify({ id: "identity-fixture", title: "Identity Fixture", version: "1.0.0" }),
  );
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "identity-fixture",
      version: "1.0.0",
      type: "module",
      main: "module.js",
      license: "SEE LICENSE IN LICENSE",
      ...packageJson,
    }),
  );
  const values = {
    MODULE_ID: "identity-fixture",
    MODULE_TITLE: "Identity Fixture",
    MODULE_VERSION: "1.0.0",
    MODULE_PATH: "modules/identity-fixture",
    ...constants,
  };
  await fs.writeFile(
    path.join(root, "src", "scripts", "constants.js"),
    Object.entries(values)
      .map(([key, value]) => `export const ${key} = ${JSON.stringify(value)};`)
      .join("\n") + "\n",
  );
  return root;
}

test("literal project identity validates without Foundry globals or manifest imports", async (t) => {
  const projectRoot = await fixture(t);
  const result = await validateProjectIdentity({ projectRoot });
  assert.equal(result.constants.MODULE_ID, result.manifest.id);
  assert.equal(result.constants.MODULE_TITLE, result.manifest.title);
  assert.equal(result.constants.MODULE_VERSION, result.packageJson.version);
});

test("identity validation identifies each conflicting project field", async (t) => {
  const cases = [
    { constants: { MODULE_ID: "another-module" }, message: /MODULE_ID must match/ },
    { constants: { MODULE_TITLE: "Another Title" }, message: /MODULE_TITLE must match/ },
    { constants: { MODULE_VERSION: "2.0.0" }, message: /MODULE_VERSION must match/ },
    { constants: { MODULE_PATH: "modules/another-module" }, message: /MODULE_PATH must derive/ },
    { packageJson: { name: "another-module" }, message: /package.json name must match/ },
    { packageJson: { version: "2.0.0" }, message: /package.json version must match/ },
    { packageJson: { main: "src/module.js" }, message: /main must be module.js/ },
    { packageJson: { license: "MIT" }, message: /license must be SEE LICENSE IN LICENSE/ },
  ];
  for (const entry of cases) {
    await t.test(String(entry.message), async (t) => {
      const projectRoot = await fixture(t, entry);
      await assert.rejects(validateProjectIdentity({ projectRoot }), entry.message);
    });
  }
});

test("translation rendering changes only the root namespace and isolates copied modules", () => {
  const source = Buffer.from(
    JSON.stringify({ __MODULE_ID__: { Title: "Settings", Literal: "__MODULE_ID__ old-module" } }),
  );
  const original = Buffer.from(source);
  const first = JSON.parse(renderLanguageSource(source, { moduleId: "first-module" }));
  const second = JSON.parse(renderLanguageSource(source, { moduleId: "second-module" }));
  assert.deepEqual(Object.keys(first), ["first-module"]);
  assert.deepEqual(Object.keys(second), ["second-module"]);
  assert.deepEqual(first["first-module"], second["second-module"]);
  assert.equal(first["first-module"].Literal, "__MODULE_ID__ old-module");
  assert.deepEqual(source, original);
});

test("translation rendering rejects project-specific or ambiguous source namespaces", () => {
  for (const value of [{ "old-module": {} }, { __MODULE_ID__: {}, other: {} }, { __MODULE_ID__: [] }, []]) {
    assert.throws(
      () =>
        renderLanguageSource(Buffer.from(JSON.stringify(value)), { moduleId: "new-module", filename: "lang/en.json" }),
      /lang\/en.json/u,
    );
  }
});

test("the actual runtime builds for a new identity after changing only the three customization files", async (t) => {
  const parent = path.join(PROJECT_ROOT, ".test-tmp");
  await fs.mkdir(parent, { recursive: true });
  const projectRoot = await fs.mkdtemp(path.join(parent, "actual-runtime-copy-"));
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));
  const sourceRoot = path.join(PROJECT_ROOT, "src");
  const copiedSource = path.join(projectRoot, "src");

  async function readTree(directory, prefix = "") {
    const files = new Map();
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      const relative = prefix + entry.name;
      assert.equal(entry.isSymbolicLink(), false, relative);
      if (entry.isDirectory()) {
        for (const [name, bytes] of await readTree(filename, relative + "/")) files.set(name, bytes);
      } else if (entry.isFile()) files.set(relative, await fs.readFile(filename));
    }
    return files;
  }

  const originals = await readTree(sourceRoot);
  await fs.cp(sourceRoot, copiedSource, { recursive: true });
  for (const filename of ["package.json", "README.md", "LICENSE", "THIRD_PARTY_NOTICES.md", "CHANGELOG.md"]) {
    await fs.copyFile(path.join(PROJECT_ROOT, filename), path.join(projectRoot, filename));
  }

  const originalManifest = JSON.parse(originals.get("module.json").toString("utf8"));
  const newId = "copied-runtime-regression";
  const newTitle = "Copied Runtime Regression";
  const manifest = { ...originalManifest, id: newId, title: newTitle };
  const packageJson = JSON.parse(await fs.readFile(path.join(projectRoot, "package.json"), "utf8"));
  await fs.writeFile(path.join(copiedSource, "module.json"), JSON.stringify(manifest));
  await fs.writeFile(path.join(projectRoot, "package.json"), JSON.stringify({ ...packageJson, name: newId }));
  const identityValues = { MODULE_ID: newId, MODULE_TITLE: newTitle };
  const constants = originals
    .get("scripts/constants.js")
    .toString("utf8")
    .replace(
      /^export\s+const\s+(MODULE_ID|MODULE_TITLE)\s*=\s*("(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*')\s*;/gmu,
      (_declaration, name) => `export const ${name} = ${JSON.stringify(identityValues[name])};`,
    );
  await fs.writeFile(path.join(copiedSource, "scripts/constants.js"), constants);

  await runBuild({ projectRoot });
  const output = path.join(projectRoot, "dist", newId);
  assert.ok((await fs.stat(path.join(output, "templates/module-settings.hbs"))).isFile());
  assert.equal(
    JSON.parse(await fs.readFile(path.join(output, "module.json"), "utf8")).version,
    originalManifest.version,
  );
  for (const language of manifest.languages) {
    const translated = JSON.parse(await fs.readFile(path.join(output, language.path), "utf8"));
    const source = JSON.parse(originals.get(language.path).toString("utf8"));
    assert.deepEqual(Object.keys(translated), [newId]);
    assert.deepEqual(translated[newId], source.__MODULE_ID__);
  }
  const stylesheet = await fs.readFile(path.join(output, "styles/module.css"), "utf8");
  assert.ok(stylesheet.includes(`.${newId}`));
  assert.equal(stylesheet.includes(`.${originalManifest.id}`), false);
  const javascript = [...(await readTree(output))]
    .filter(([filename]) => filename.endsWith(".js"))
    .map(([, bytes]) => bytes.toString("utf8"))
    .join("\n");
  assert.ok(javascript.includes(newId));
  assert.ok(javascript.includes(newTitle));
  assert.ok(javascript.includes("templates/module-settings.hbs"));
  assert.equal(javascript.includes(originalManifest.id), false);
  for (const [filename, bytes] of originals) {
    if (["module.json", "scripts/constants.js"].includes(filename)) continue;
    assert.deepEqual(await fs.readFile(path.join(copiedSource, filename)), bytes, filename);
  }
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { PROJECT_ROOT } from "../build/config.js";
import {
  INSTALL_SECTION_END,
  INSTALL_SECTION_START,
  CHANGELOG_SECTION_START,
  packageExistingDirectory,
  prepareRelease,
  renderChangelogSection,
  renderInstallationSection,
  updateReleaseBody,
} from "../build/release.js";
import { decodeZip, encodeZip } from "../build/zip.js";
import {
  collectModuleFiles,
  extractChangelogEntry,
  parseReleaseTag,
  readProjectReleaseVersion,
  releaseUrls,
  validateRepository,
  verifyModuleFiles,
  verifyPackage,
} from "../build/verify-package.js";
import { compareUpstream, readUpstreamBaseline } from "../utils/upstream.js";

const REPOSITORY = "example-owner/example-module";
const TAG = "1.2.3";

function fixture(t, version = TAG) {
  const temporary = path.join(PROJECT_ROOT, ".test-tmp");
  fs.mkdirSync(temporary, { recursive: true });
  const root = fs.mkdtempSync(path.join(temporary, "release-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const moduleDirectory = path.join(root, "example-module");
  const artifactDirectory = path.join(root, "artifacts");
  const manifest = {
    id: "example-module",
    title: "Example Module",
    version,
    compatibility: { minimum: "14" },
    esmodules: ["module.js"],
    styles: ["styles/module.css"],
    languages: [{ lang: "en", name: "English", path: "lang/en.json" }],
    packs: [],
  };
  const files = {
    "module.json": JSON.stringify(manifest, null, 2) + "\n",
    "module.js": "export const example = true;\n",
    "styles/module.css": ".example-module { display: block; }\n",
    "lang/en.json": JSON.stringify({ EXAMPLE: { Title: "Example" } }) + "\n",
    "templates/example.hbs": "<p>{{title}}</p>\n",
    "assets/example.svg": '<svg xmlns="http://www.w3.org/2000/svg"/>\n',
    "README.md": "# Example Module\n",
    "CHANGELOG.md": `# Changelog\n\n## [Unreleased]\n\n## [${version}] - 2026-11-19\n\n### Added\n\n- Add the example module.\n\n## [1.2.2] - 2026-10-01\n\n### Fixed\n\n- Repair a previous version.\n`,
    LICENSE: "MIT License\n",
    "THIRD_PARTY_NOTICES.md": "# Third-party notices\n",
    "wiki/runtime.md": "# Runtime\n",
  };
  for (const [filename, content] of Object.entries(files)) {
    const absolute = path.join(moduleDirectory, filename);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content);
  }
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "module.json"), JSON.stringify(manifest));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: manifest.id, version }));
  return {
    root,
    projectRoot: root,
    moduleDirectory,
    artifactDirectory,
    manifest,
    tag: version,
    repository: REPOSITORY,
  };
}

test("release tags and repositories reject ambiguous or unsafe values", () => {
  assert.deepEqual(parseReleaseTag("1.2.3-rc.1+build.7"), {
    tag: "1.2.3-rc.1+build.7",
    version: "1.2.3-rc.1+build.7",
  });
  for (const tag of [
    "main",
    "v1",
    "v1.2.3",
    "v1.2.3-rc.1",
    "v1.2.3+build.7",
    "1.2",
    "01.2.3",
    "1.2.3-01",
    "../1.2.3",
    "1.2.3\n",
    "1.2.3/other",
  ]) {
    assert.throws(() => parseReleaseTag(tag), /semantic version/u, tag);
  }
  for (const repository of ["../repo", "owner/repo/other", "owner repo/name", "https://github.com/owner/repo"]) {
    assert.throws(() => validateRepository(repository), /owner\/name/u);
  }
  assert.equal(
    releaseUrls(REPOSITORY, "1.2.3+build.7").download,
    "https://github.com/" + REPOSITORY + "/releases/download/1.2.3%2Bbuild.7/module.zip",
  );
});

test("prerelease update manifests are pinned while stable versions retain the stable feed", () => {
  const stableManifest = "https://github.com/" + REPOSITORY + "/releases/latest/download/module.json";
  const stable = releaseUrls(REPOSITORY, "1.2.3+build-7");
  assert.equal(stable.prerelease, false);
  assert.equal(stable.manifest, stableManifest);
  assert.equal(stable.stableManifest, stableManifest);

  const prerelease = releaseUrls(REPOSITORY, "1.2.3-rc.1+build-7");
  const exactBase = "https://github.com/" + REPOSITORY + "/releases/download/1.2.3-rc.1%2Bbuild-7";
  assert.equal(prerelease.prerelease, true);
  assert.equal(prerelease.manifest, exactBase + "/module.json");
  assert.equal(prerelease.attachedManifest, prerelease.manifest);
  assert.equal(prerelease.download, exactBase + "/module.zip");
  assert.equal(prerelease.stableManifest, stableManifest);
  assert.notEqual(prerelease.manifest, prerelease.stableManifest);
});

test("the project release version comes from the source manifest and matches package metadata exactly", (t) => {
  const input = fixture(t, "1.2.3-rc.1+build.7");
  assert.equal(readProjectReleaseVersion(input.projectRoot), "1.2.3-rc.1+build.7");
  fs.writeFileSync(path.join(input.projectRoot, "package.json"), JSON.stringify({ version: "1.2.3-rc.1+build.8" }));
  assert.throws(() => readProjectReleaseVersion(input.projectRoot), /must match.*exactly/u);
});

test("source versions reject prefixes, whitespace, and invalid SemVer even when package versions agree", (t) => {
  const input = fixture(t);
  for (const version of ["v1.2.3", "1.2.3\n", " 1.2.3", "01.2.3", "1.2.3-01"]) {
    fs.writeFileSync(
      path.join(input.projectRoot, "src", "module.json"),
      JSON.stringify({ ...input.manifest, version }),
    );
    fs.writeFileSync(path.join(input.projectRoot, "package.json"), JSON.stringify({ version }));
    assert.throws(() => readProjectReleaseVersion(input.projectRoot), /semantic version/u, version);
  }
});

test("packaging emits an id directory, exact-release URLs, identical manifests, and deterministic bytes", (t) => {
  const input = fixture(t);
  const original = fs.readFileSync(path.join(input.moduleDirectory, "module.json"));
  const result = packageExistingDirectory(input);
  const external = fs.readFileSync(result.manifestPath);
  const firstZip = fs.readFileSync(result.zipPath);
  const entries = decodeZip(firstZip);
  assert.equal(result.manifest.version, "1.2.3");
  assert.equal(result.manifest.manifest, "https://github.com/" + REPOSITORY + "/releases/latest/download/module.json");
  assert.equal(result.manifest.download, "https://github.com/" + REPOSITORY + "/releases/download/1.2.3/module.zip");
  assert.ok([...entries.keys()].every((name) => name.startsWith("example-module/")));
  assert.ok(entries.get("example-module/module.json").equals(external));
  assert.equal(entries.has("module.json"), false);
  assert.equal(entries.has("example-module/package.json"), false);
  assert.ok(fs.readFileSync(path.join(input.moduleDirectory, "module.json")).equals(original));
  assert.equal(result.manifest.compatibility.verified, undefined);
  assert.equal(verifyPackage({ ...result, tag: TAG, repository: REPOSITORY }).fileCount, 11);
  assert.match(
    fs.readFileSync(path.join(input.artifactDirectory, "changelog-section.md"), "utf8"),
    /Add the example module/u,
  );
  assert.doesNotMatch(
    fs.readFileSync(path.join(input.artifactDirectory, "changelog-section.md"), "utf8"),
    /Repair a previous version/u,
  );
  packageExistingDirectory(input);
  assert.ok(fs.readFileSync(result.zipPath).equals(firstZip));
});

test("prerelease packaging verifies pinned manifests and rejects a stable-feed substitution", (t) => {
  const input = fixture(t, "1.2.3-rc.1");
  fs.writeFileSync(
    path.join(input.moduleDirectory, "CHANGELOG.md"),
    "# Changelog\n\n## [1.2.3-rc.1] - 2026-11-19\n\n### Added\n\n- Add the release candidate.\n",
  );
  const result = packageExistingDirectory(input);
  const urls = releaseUrls(input.repository, input.tag);
  assert.equal(result.manifest.version, "1.2.3-rc.1");
  assert.equal(result.manifest.manifest, urls.attachedManifest);
  assert.equal(result.manifest.download, urls.download);
  assert.equal(verifyPackage({ ...result, tag: input.tag, repository: input.repository }).fileCount, 11);

  const archive = decodeZip(fs.readFileSync(result.zipPath));
  const bytes = Buffer.from(JSON.stringify({ ...result.manifest, manifest: urls.stableManifest }));
  archive.set("example-module/module.json", bytes);
  fs.writeFileSync(result.manifestPath, bytes);
  fs.writeFileSync(result.zipPath, encodeZip(archive));
  assert.throws(
    () => verifyPackage({ ...result, tag: input.tag, repository: input.repository }),
    /prerelease manifest.*exact release tag/u,
  );
});

test("release preparation requires an explicit tag", () => {
  assert.throws(() => prepareRelease({ repository: REPOSITORY }), /release tag is required/iu);
});

test("packaging stamps the manual version only in release artifacts", async (t) => {
  for (const version of ["1.3.0", "1.3.0-rc.2"]) {
    await t.test(version, (t) => {
      const input = { ...fixture(t), tag: version };
      const preservedFiles = [
        path.join(input.moduleDirectory, "module.json"),
        path.join(input.projectRoot, "src", "module.json"),
        path.join(input.projectRoot, "package.json"),
      ];
      const originals = preservedFiles.map((filename) => fs.readFileSync(filename));
      fs.writeFileSync(
        path.join(input.moduleDirectory, "CHANGELOG.md"),
        `# Changelog\n\n## [${version}] - 2026-11-19\n\n### Changed\n\n- Package the manually selected version.\n`,
      );
      const result = packageExistingDirectory(input);
      assert.equal(result.manifest.version, version);
      const verified = verifyPackage({ ...result, tag: version, repository: REPOSITORY });
      assert.equal(verified.manifest.version, version);
      assert.equal(verified.changelog.version, version);
      assert.equal(
        verified.manifest.download,
        `https://github.com/${REPOSITORY}/releases/download/${version}/module.zip`,
      );
      for (const [index, filename] of preservedFiles.entries()) {
        assert.ok(fs.readFileSync(filename).equals(originals[index]), filename);
      }
    });
  }
});

test("missing manifest assets fail and remove stale release artifacts", (t) => {
  const input = fixture(t);
  packageExistingDirectory(input);
  fs.rmSync(path.join(input.moduleDirectory, "lang/en.json"));
  assert.throws(() => packageExistingDirectory(input), /missing file: lang\/en.json/u);
  assert.equal(fs.existsSync(path.join(input.artifactDirectory, "module.zip")), false);
  assert.equal(fs.existsSync(path.join(input.artifactDirectory, "module.json")), false);
});

test("release verifier rejects tag mismatches and divergent attached manifests", (t) => {
  const input = fixture(t);
  const result = packageExistingDirectory(input);
  assert.throws(() => verifyPackage({ ...result, tag: "9.0.0", repository: REPOSITORY }), /version does not match/u);
  fs.appendFileSync(result.manifestPath, "\n");
  assert.throws(() => verifyPackage({ ...result, tag: TAG, repository: REPOSITORY }), /byte-identical/u);
});

test("release verifier rejects a latest ZIP URL even when both manifests agree", (t) => {
  const input = fixture(t);
  const result = packageExistingDirectory(input);
  const archive = decodeZip(fs.readFileSync(result.zipPath));
  const manifest = {
    ...result.manifest,
    download: "https://github.com/" + REPOSITORY + "/releases/latest/download/module.zip",
  };
  const bytes = Buffer.from(JSON.stringify(manifest));
  archive.set("example-module/module.json", bytes);
  fs.writeFileSync(result.manifestPath, bytes);
  fs.writeFileSync(result.zipPath, encodeZip(archive));
  assert.throws(() => verifyPackage({ ...result, tag: TAG, repository: REPOSITORY }), /exact release tag/u);
});

test("development files and source maps cannot leak into release archives", (t) => {
  const input = fixture(t);
  const files = collectModuleFiles(input.moduleDirectory);
  for (const name of [
    "src/feature.js",
    "node_modules/dependency/index.js",
    "module.js.map",
    "styles/module.scss",
    ".env",
    "build/release.js",
    "utils/packs.js",
  ]) {
    const changed = new Map(files);
    changed.set(name, Buffer.from("unexpected"));
    assert.throws(() => verifyModuleFiles(changed), /Development or unexpected file/u, name);
  }
});

test("compiled packs are required when declared", (t) => {
  const input = fixture(t);
  const files = collectModuleFiles(input.moduleDirectory);
  input.manifest.packs = [{ name: "example-items", type: "Item", path: "packs/example-items" }];
  files.set("module.json", Buffer.from(JSON.stringify(input.manifest)));
  assert.throws(() => verifyModuleFiles(files), /missing compiled pack/u);
  files.set("packs/example-items/CURRENT", Buffer.from("MANIFEST-000001\n"));
  assert.equal(verifyModuleFiles(files).manifest.packs.length, 1);
});

test("invalid language JSON and traversal paths fail validation", (t) => {
  const input = fixture(t);
  const files = collectModuleFiles(input.moduleDirectory);
  files.set("lang/en.json", Buffer.from("{ invalid"));
  assert.throws(() => verifyModuleFiles(files), /Invalid language JSON/u);
  input.manifest.esmodules = ["../module.js"];
  files.set("module.json", Buffer.from(JSON.stringify(input.manifest)));
  assert.throws(() => verifyModuleFiles(files), /Unsafe archive path/u);
});

test("filesystem links are excluded from package input", (t) => {
  const input = fixture(t);
  try {
    fs.symlinkSync(path.join(input.moduleDirectory, "module.js"), path.join(input.moduleDirectory, "linked.js"));
  } catch (error) {
    if (error.code === "EPERM") {
      t.skip("This operating system does not permit test symlinks.");
      return;
    }
    throw error;
  }
  assert.throws(() => collectModuleFiles(input.moduleDirectory), /symbolic links/u);
});

test("ZIP writer rejects unsafe names and ZIP reader checks checksums and truncation", () => {
  for (const name of ["../escape.js", "/absolute.js", "folder\\file.js", "a//b.js", "a/./b.js", "C:/file.js"]) {
    assert.throws(() => encodeZip(new Map([[name, Buffer.from("x")]])), /archive path/iu);
  }
  const zip = encodeZip(new Map([["example-module/module.js", Buffer.from("export default 1;\n")]]));
  assert.throws(() => decodeZip(zip.subarray(0, zip.length - 4)), /ZIP/u);
  const corrupt = Buffer.from(zip);
  const central = corrupt.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  const badCrc = (corrupt.readUInt32LE(14) ^ 0xff) >>> 0;
  corrupt.writeUInt32LE(badCrc, 14);
  corrupt.writeUInt32LE(badCrc, central + 16);
  assert.throws(() => decodeZip(corrupt), /checksum/u);
  assert.throws(() => decodeZip(zip, { maxUncompressedBytes: 1 }), /size limit/u);
});

test("ZIP reader rejects duplicate entries and symbolic-link attributes", () => {
  const duplicate = encodeZip(
    new Map([
      ["a.txt", Buffer.from("a")],
      ["b.txt", Buffer.from("b")],
    ]),
  );
  let position = duplicate.indexOf(Buffer.from("b.txt"));
  while (position !== -1) {
    duplicate.write("a.txt", position, "utf8");
    position = duplicate.indexOf(Buffer.from("b.txt"), position + 5);
  }
  assert.throws(() => decodeZip(duplicate), /Duplicate archive path/u);
  const symlink = encodeZip(new Map([["a.txt", Buffer.from("target")]]));
  const central = symlink.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  symlink.writeUInt32LE((0o120777 << 16) >>> 0, central + 38);
  assert.throws(() => decodeZip(symlink), /Symbolic links/u);
});

test("ZIP output cannot contain files outside the module id directory", (t) => {
  const input = fixture(t);
  const result = packageExistingDirectory(input);
  const entries = decodeZip(fs.readFileSync(result.zipPath));
  entries.set("outside.txt", Buffer.from("unexpected"));
  fs.writeFileSync(result.zipPath, encodeZip(entries));
  assert.throws(
    () => verifyPackage({ ...result, tag: TAG, repository: REPOSITORY }),
    /inside the module id directory/u,
  );
});

test("installation notes include specific assets and preserve author-written text", () => {
  const section = renderInstallationSection({ tag: TAG, repository: REPOSITORY, moduleId: "example-module" });
  assert.match(section, /releases\/download\/1\.2\.3\/module\.json/u);
  assert.match(section, /releases\/download\/1\.2\.3\/module\.zip/u);
  assert.match(section, /latest stable release/u);
  assert.match(section, /follows the latest stable update feed/u);
  assert.match(section, /Data\/modules\/example-module\/module\.json/u);
  const original = "# Changes\n\nAuthor-written release notes.\n";
  const first = updateReleaseBody(original, section);
  assert.ok(first.startsWith(original));
  const withFooter = first + "\nA handwritten footer.\n";
  const newer = renderInstallationSection({ tag: "1.2.4", repository: REPOSITORY, moduleId: "example-module" });
  const updated = updateReleaseBody(withFooter, newer);
  assert.ok(updated.startsWith(original));
  assert.ok(updated.endsWith("\nA handwritten footer.\n"));
  assert.equal(updated.split(INSTALL_SECTION_START).length - 1, 1);
  assert.throws(() => updateReleaseBody(INSTALL_SECTION_START + "\nUnclosed section", section), /ambiguous/u);
  assert.throws(() => updateReleaseBody(INSTALL_SECTION_END + INSTALL_SECTION_START, section), /ambiguous/u);
});

test("prerelease installation notes explain the pinned policy and exact manifest", () => {
  const section = renderInstallationSection({
    tag: "1.2.3-rc.1",
    repository: REPOSITORY,
    moduleId: "example-module",
  });
  assert.match(section, /pinned to this exact prerelease/u);
  assert.match(section, /does not automatically follow later prereleases or the stable feed/u);
  assert.match(section, /releases\/download\/1\.2\.3-rc\.1\/module\.json/u);
  assert.doesNotMatch(section, /releases\/latest\/download\/module\.json/u);
  assert.doesNotMatch(section, /\{\{[A-Z_]+\}\}/u);
});

test("manual upstream comparison requests only the explicit source-file allowlist", async () => {
  const baseline = readUpstreamBaseline();
  const calls = [];
  const results = await compareUpstream({
    baseline,
    fetchImplementation: async (url, options) => {
      calls.push({ url, options });
      const file = baseline.files.find((item) => url.includes("/contents/" + item.path + "?"));
      assert.ok(file);
      return { ok: true, status: 200, json: async () => ({ type: "file", path: file.path, sha: file.gitBlobSha }) };
    },
  });
  assert.equal(calls.length, baseline.files.length);
  assert.ok(results.every((item) => item.status === "unchanged"));
  assert.ok(
    calls.every((item) =>
      item.url.startsWith("https://api.github.com/repos/DFreds/dfreds-module-template-ts/contents/"),
    ),
  );
  assert.ok(calls.every((item) => item.options.redirect === "error"));
});

test("changelog selection requires the exact version and supports explicit prerelease entries", () => {
  const text =
    "# Changelog\n\n## [Unreleased]\n\n### Added\n\n- Future work.\n\n## [1.2.3-rc.1] - 2026-11-19\n\n### Fixed\n\n- Fix the release candidate.\n\n## [1.2.2] - 2026-10-01\n\n### Changed\n\n- Older change.\n";
  const entry = extractChangelogEntry(text, "1.2.3-rc.1");
  assert.equal(entry.version, "1.2.3-rc.1");
  assert.equal(entry.date, "2026-11-19");
  assert.match(entry.body, /Fix the release candidate/u);
  assert.doesNotMatch(entry.body, /Future work|Older change/u);
  assert.throws(() => extractChangelogEntry(text, "1.2.3"), /exactly one section/u);
});

test("changelog validation rejects missing, empty, duplicate, undated, and invalid entries", () => {
  const invalid = [
    "# Changelog\n\n## [Unreleased]\n",
    "## [1.2.3] - 2026-11-19\n\n",
    "## [1.2.3] - TBD\n\n### Added\n\n- A change.\n",
    "## [1.2.3] - 2026-02-30\n\n### Added\n\n- A change.\n",
    "## [1.2.3] - 2026-11-19\n\n### Added\n\n- TBD\n",
    "## [1.2.3] - 2026-11-19\n\n### Improvements\n\n- A change.\n",
    "## [1.2.3] - 2026-11-19\n\n### Added\n\n- A change.\n\n### Fixed\n",
    "## [1.2.3] - 2026-11-19\n\n### Added\n\n- A change.\n\n## [1.2.3] - 2026-11-20\n",
  ];
  for (const text of invalid) assert.throws(() => extractChangelogEntry(text, TAG), /CHANGELOG\.md/u);
});

test("a release cannot package Unreleased notes as its version changelog", (t) => {
  const input = fixture(t);
  fs.writeFileSync(
    path.join(input.moduleDirectory, "CHANGELOG.md"),
    "# Changelog\n\n## [Unreleased]\n\n### Added\n\n- Future work.\n",
  );
  assert.throws(() => packageExistingDirectory(input), /Unreleased does not substitute/u);
  assert.equal(fs.existsSync(path.join(input.artifactDirectory, "module.zip")), false);
});

test("extracted changelog notes retain global Markdown reference definitions", () => {
  const text =
    "# Changelog\n\n## [Unreleased]\n\n## [1.2.3] - 2026-11-19\n\n### Changed\n\n- Follow the [migration guide][guide].\n\n## [1.2.2] - 2026-10-01\n\n### Fixed\n\n- An older fix.\n\n[guide]: https://example.com/migration\n";
  const entry = extractChangelogEntry(text, TAG);
  assert.match(entry.body, /\[migration guide\]\[guide\]/u);
  assert.match(entry.body, /^\[guide\]: https:\/\/example\.com\/migration$/mu);
  assert.doesNotMatch(entry.body, /An older fix/u);
});

test("generated changelog and installation sections preserve unrelated release text", () => {
  const installation = renderInstallationSection({ tag: TAG, repository: REPOSITORY, moduleId: "example-module" });
  const changes = renderChangelogSection({
    version: "1.2.3",
    date: "2026-11-19",
    body: "### Added\n\n- A curated change.",
  });
  const authorText = "# Maintainer notes\n\nKeep these notes exactly.\n";
  const first = updateReleaseBody(authorText, installation, changes);
  assert.ok(first.startsWith(authorText));
  assert.equal(first.split(CHANGELOG_SECTION_START).length - 1, 1);
  assert.equal(first.split(INSTALL_SECTION_START).length - 1, 1);
  const revised = renderChangelogSection({
    version: "1.2.3",
    date: "2026-11-19",
    body: "### Fixed\n\n- An edited curated change.",
  });
  const second = updateReleaseBody(first + "\nKeep this footer.\n", installation, revised);
  assert.ok(second.startsWith(authorText));
  assert.ok(second.endsWith("\nKeep this footer.\n"));
  assert.doesNotMatch(second, /- A curated change\./u);
  assert.match(second, /An edited curated change/u);
});

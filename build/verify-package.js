import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { PROJECT_ROOT, getModuleDirectory, isMain } from "./config.js";
import { assertArchivePath, decodeZip, MAX_UNCOMPRESSED_BYTES } from "./zip.js";

const RUNTIME_DIRECTORIES = new Set(["assets", "lang", "styles", "templates", "scripts", "packs", "chunks", "wiki"]);
const ROOT_FILES = new Set(["module.json", "README.md", "CHANGELOG.md", "LICENSE", "THIRD_PARTY_NOTICES.md"]);
const REQUIRED_FILES = ["module.json", "README.md", "CHANGELOG.md", "LICENSE", "THIRD_PARTY_NOTICES.md"];
const CHANGE_CATEGORIES = new Set(["Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"]);

export function validateModuleId(id) {
  if (typeof id !== "string" || !/^[a-z][a-z0-9-]*$/u.test(id)) {
    throw new Error(
      "Module id must start with a lowercase letter and contain only lowercase letters, digits, and hyphens.",
    );
  }
  return id;
}

export function parseReleaseTag(tag) {
  if (typeof tag !== "string") throw new Error("A release tag is required.");
  const version = tag.startsWith("v") ? tag.slice(1) : tag;
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u.exec(
      version,
    );
  if (!match || match[4]?.split(".").some((item) => /^\d+$/u.test(item) && item.length > 1 && item.startsWith("0"))) {
    throw new Error("Release tag must be a semantic version, optionally prefixed with v.");
  }
  return { tag, version };
}

export function extractChangelogEntry(changelog, tag) {
  const { version } = parseReleaseTag(tag);
  if (typeof changelog !== "string") throw new Error("CHANGELOG.md must contain Markdown text.");
  const lines = changelog.replaceAll("\r\n", "\n").split("\n");
  const matches = [];
  for (let index = 0; index < lines.length; index += 1) {
    const heading = /^## \[([^\]]+)\](.*)$/u.exec(lines[index]);
    if (heading?.[1] === version) matches.push(index);
  }
  if (matches.length !== 1) {
    throw new Error(
      "CHANGELOG.md must contain exactly one section for [" +
        version +
        "] in the format ## [" +
        version +
        "] - YYYY-MM-DD; Unreleased does not substitute for a version entry.",
    );
  }
  const start = matches[0];
  const datedHeading = /^## \[([^\]]+)\] - (\d{4}-\d{2}-\d{2})$/u.exec(lines[start]);
  const date = datedHeading?.[2];
  const parsedDate = date ? new Date(date + "T00:00:00.000Z") : undefined;
  if (!date || !Number.isFinite(parsedDate?.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
    throw new Error("CHANGELOG.md entry [" + version + "] requires a valid YYYY-MM-DD date.");
  }
  let end = start + 1;
  while (end < lines.length && !/^##\s/u.test(lines[end])) end += 1;
  const body = lines
    .slice(start + 1, end)
    .filter((line) => !/^\[[^\]]+\]:\s/u.test(line))
    .join("\n")
    .trim();
  if (body.includes("<!-- foundry-module-template:")) {
    throw new Error("CHANGELOG.md entries cannot contain generated release-section markers.");
  }
  const meaningful = body.replace(/<!--[\s\S]*?-->/gu, "").trim();
  const sections = meaningful.split(/^### /mu);
  if (sections.length < 2) {
    throw new Error("CHANGELOG.md entry [" + version + "] is empty or has no supported change category.");
  }
  const seen = new Set();
  for (const section of sections.slice(1)) {
    const [category, ...content] = section.split("\n");
    if (!CHANGE_CATEGORIES.has(category) || seen.has(category)) {
      throw new Error("CHANGELOG.md contains an unknown or duplicate change category: " + category);
    }
    seen.add(category);
    const items = content.map((line) => /^\s*[-*]\s+(.+)$/u.exec(line)?.[1]?.trim()).filter(Boolean);
    if (!items.length || items.some((item) => /^(?:TODO|TBD|pending|none|n\/a|no changes)[.!]?$/iu.test(item))) {
      throw new Error("CHANGELOG.md category " + category + " must contain a meaningful change.");
    }
  }
  const references = [...new Set(lines.filter((line) => /^\[[^\]]+\]:\s/u.test(line)))];
  const completeBody = body + (references.length ? "\n\n" + references.join("\n") : "");
  return { version, date, body: completeBody };
}

export function validateRepository(repository) {
  if (
    typeof repository !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(repository) ||
    repository.split("/").some((part) => part === "." || part === "..")
  ) {
    throw new Error("Repository must be an owner/name GitHub repository.");
  }
  return repository;
}

export function releaseUrls(repository, tag) {
  validateRepository(repository);
  const { version } = parseReleaseTag(tag);
  const prerelease = version.split("+", 1)[0].includes("-");
  const base = "https://github.com/" + repository;
  const releaseBase = base + "/releases/download/" + encodeURIComponent(tag);
  const stableManifest = base + "/releases/latest/download/module.json";
  const attachedManifest = releaseBase + "/module.json";
  return {
    repositoryUrl: base,
    prerelease,
    manifest: prerelease ? attachedManifest : stableManifest,
    stableManifest,
    download: releaseBase + "/module.zip",
    attachedManifest,
    latestRelease: base + "/releases/latest",
  };
}

function normalizeManifestPath(value) {
  if (typeof value !== "string") throw new Error("Manifest asset paths must be strings.");
  const normalized = value.startsWith("./") ? value.slice(2) : value;
  assertArchivePath(normalized);
  if (/[?#]/u.test(normalized)) throw new Error("Manifest asset paths cannot contain query strings or fragments.");
  return normalized;
}

function assertRuntimePath(name) {
  assertArchivePath(name);
  const parts = name.split("/");
  if (
    parts.some(
      (part) => part.startsWith(".") || part === "node_modules" || part === "__tests__" || part === "_source",
    ) ||
    /\.(?:ts|tsx|jsx|scss|sass|less|map)$/iu.test(name) ||
    /(?:^|\/)[^/]*\.(?:test|spec)\.[cm]?js$/iu.test(name) ||
    name.endsWith(".lock") ||
    (parts.length > 1 && !RUNTIME_DIRECTORIES.has(parts[0])) ||
    (parts.length === 1 && !ROOT_FILES.has(name) && !/\.(?:js|mjs|css)$/u.test(name))
  ) {
    throw new Error("Development or unexpected file in distributable: " + name);
  }
}

export function collectModuleFiles(directory) {
  const root = path.resolve(directory);
  const files = new Map();
  function walk(current, prefix = "") {
    const info = fs.lstatSync(current);
    if (info.isSymbolicLink()) throw new Error("Release input cannot contain symbolic links: " + current);
    if (!info.isDirectory()) throw new Error("Module directory is not a directory: " + current);
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix ? prefix + "/" + entry.name : entry.name;
      const absolute = path.join(current, entry.name);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error("Release input cannot contain symbolic links: " + relative);
      if (stat.isDirectory()) walk(absolute, relative);
      else if (stat.isFile()) {
        assertRuntimePath(relative);
        if (stat.size > MAX_UNCOMPRESSED_BYTES)
          throw new Error("Release file exceeds the package size limit: " + relative);
        files.set(relative, fs.readFileSync(absolute));
      } else throw new Error("Unsupported filesystem entry: " + relative);
    }
  }
  walk(root);
  return files;
}

export function verifyModuleFiles(files, { tag, repository, release = false } = {}) {
  for (const name of files.keys()) assertRuntimePath(name);
  for (const name of REQUIRED_FILES) {
    if (!files.has(name) || !files.get(name).length)
      throw new Error("Required distribution file is missing or empty: " + name);
  }
  let manifest;
  try {
    manifest = JSON.parse(files.get("module.json").toString("utf8"));
  } catch (error) {
    throw new Error("Distribution module.json is invalid JSON.", { cause: error });
  }
  validateModuleId(manifest.id);
  if (!manifest.title || !manifest.version) throw new Error("Manifest title and version are required.");
  parseReleaseTag(String(manifest.version));
  if (manifest.compatibility?.minimum == null) {
    throw new Error("Manifest compatibility.minimum is required.");
  }
  for (const field of ["minimum", "verified", "maximum"]) {
    const value = manifest.compatibility[field];
    if (value != null && !/^\d+(?:\.\d+)*$/u.test(String(value))) {
      throw new Error("Manifest compatibility." + field + " must be a Foundry version when supplied.");
    }
  }
  function requireFile(value) {
    const name = normalizeManifestPath(value);
    if (!files.has(name)) throw new Error("Manifest refers to a missing file: " + name);
  }
  if (!Array.isArray(manifest.esmodules) || manifest.esmodules.length === 0) {
    throw new Error("Manifest must declare at least one ES module.");
  }
  for (const field of ["esmodules", "scripts", "styles"]) {
    if (manifest[field] != null && !Array.isArray(manifest[field]))
      throw new Error("Manifest " + field + " must be an array.");
    for (const asset of manifest[field] ?? []) requireFile(asset);
  }
  if (manifest.languages != null && !Array.isArray(manifest.languages))
    throw new Error("Manifest languages must be an array.");
  for (const language of manifest.languages ?? []) {
    if (!language.lang || !language.name) throw new Error("Each language requires lang, name, and path.");
    requireFile(language.path);
    try {
      JSON.parse(files.get(normalizeManifestPath(language.path)).toString("utf8"));
    } catch (error) {
      throw new Error("Invalid language JSON: " + language.path, { cause: error });
    }
  }
  if (manifest.packs != null && !Array.isArray(manifest.packs)) throw new Error("Manifest packs must be an array.");
  for (const pack of manifest.packs ?? []) {
    const prefix = normalizeManifestPath(pack.path);
    if (!prefix.startsWith("packs/") || ![...files.keys()].some((name) => name.startsWith(prefix + "/"))) {
      throw new Error("Manifest refers to a missing compiled pack: " + prefix);
    }
  }
  let changelog;
  if (release || tag != null || repository != null) {
    const parsed = parseReleaseTag(tag);
    const expected = releaseUrls(repository, parsed.tag);
    if (manifest.version !== parsed.version) throw new Error("Manifest version does not match the release tag.");
    if (manifest.url !== expected.repositoryUrl)
      throw new Error("Manifest repository URL does not match the release repository.");
    if (manifest.manifest !== expected.manifest) {
      throw new Error(
        expected.prerelease
          ? "A prerelease manifest must point to module.json on its exact release tag."
          : "A stable manifest must point to the latest stable release manifest.",
      );
    }
    if (manifest.download !== expected.download)
      throw new Error("Manifest download must point to module.zip on the exact release tag.");
    changelog = extractChangelogEntry(files.get("CHANGELOG.md").toString("utf8"), parsed.tag);
  }
  return { manifest, fileCount: files.size, changelog };
}

export function verifyModuleDirectory(directory, options = {}) {
  return verifyModuleFiles(collectModuleFiles(directory), options);
}

export function verifyPackage({ manifestPath, zipPath, tag, repository }) {
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  validateModuleId(manifest.id);
  const archiveStat = fs.statSync(zipPath);
  if (archiveStat.size > MAX_UNCOMPRESSED_BYTES + 16 * 1024 * 1024) {
    throw new Error("Release archive exceeds the package size limit.");
  }
  const archive = decodeZip(fs.readFileSync(zipPath));
  const prefix = manifest.id + "/";
  const files = new Map();
  for (const [name, data] of archive) {
    if (!name.startsWith(prefix)) throw new Error("Every ZIP entry must be inside the module id directory.");
    if (name.endsWith("/")) continue;
    const relative = name.slice(prefix.length);
    assertRuntimePath(relative);
    files.set(relative, data);
  }
  if (!files.get("module.json")?.equals(manifestBytes)) {
    throw new Error("Attached module.json and the ZIP manifest must be byte-identical.");
  }
  return verifyModuleFiles(files, { tag, repository, release: true });
}

function main() {
  const { values } = parseArgs({
    options: {
      directory: { type: "string" },
      artifacts: { type: "string" },
      tag: { type: "string" },
      repository: { type: "string" },
    },
  });
  const result = values.artifacts
    ? verifyPackage({
        manifestPath: path.resolve(values.artifacts, "module.json"),
        zipPath: path.resolve(values.artifacts, "module.zip"),
        tag: values.tag ?? process.env.RELEASE_TAG,
        repository: values.repository ?? process.env.GITHUB_REPOSITORY,
      })
    : verifyModuleDirectory(values.directory ? path.resolve(PROJECT_ROOT, values.directory) : getModuleDirectory());
  console.log("Verified " + result.manifest.id + ": " + result.fileCount + " distribution files.");
}

if (isMain(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

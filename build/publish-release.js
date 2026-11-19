import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { PROJECT_ROOT, isMain, reportError } from "./config.js";
import { parseReleaseTag, readProjectReleaseVersion, validateRepository, verifyPackage } from "./verify-package.js";
import { renderChangelogSection, renderInstallationSection, updateReleaseBody } from "./release.js";

const COMMIT_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/iu;
const ASSET_NAMES = ["module.json", "module.zip"];

export function normalizeReleaseRequest(version, channel, commit) {
  if (!["stable", "prerelease"].includes(channel)) {
    throw new Error("Release channel must be stable or prerelease.");
  }
  const parsed = parseReleaseTag(version);
  const prerelease = parsed.version.split("+")[0].includes("-");
  if ((channel === "prerelease") !== prerelease) {
    throw new Error(
      channel === "stable"
        ? "The stable workflow requires a version without a prerelease suffix."
        : "The prerelease workflow requires a suffix such as 14.0.1-rc.1.",
    );
  }
  if (typeof commit !== "string" || !COMMIT_PATTERN.test(commit)) {
    throw new Error("A full Git commit SHA is required; branches and abbreviated SHAs are not accepted.");
  }
  return { version: parsed.version, tag: parsed.version, channel, commit: commit.toLowerCase(), prerelease };
}

export function publicationMarker({ tag, channel, commit }) {
  return `<!-- foundry-module-template:publication ${tag} ${channel} ${commit} -->`;
}

export function createGitHubApi(token, fetchImplementation = fetch) {
  if (typeof token !== "string" || !token.trim()) throw new Error("GH_TOKEN is required to publish a release.");
  return {
    async request(method, resource, { json, body, contentType, upload = false } = {}) {
      if (!resource.startsWith("/repos/") || resource.includes("#")) {
        throw new Error("GitHub requests must use repository API paths.");
      }
      const response = await fetchImplementation(`https://${upload ? "uploads" : "api"}.github.com${resource}`, {
        method,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "foundryvtt-module-template-release",
          ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(body !== undefined ? { "Content-Type": contentType ?? "application/octet-stream" } : {}),
        },
        body: json !== undefined ? JSON.stringify(json) : body,
        redirect: "error",
        signal: AbortSignal.timeout(upload ? 180000 : 30000),
      });
      if (!response.ok) {
        const error = new Error(`GitHub returned HTTP ${response.status} for ${method} ${resource}.`);
        error.status = response.status;
        throw error;
      }
      return response.status === 204 ? null : response.json();
    },
  };
}

async function optionalGet(api, resource) {
  try {
    return await api.request("GET", resource);
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

async function listAll(api, resource) {
  const items = [];
  for (let page = 1; page <= 100; page += 1) {
    const result = await api.request("GET", `${resource}?per_page=100&page=${page}`);
    if (!Array.isArray(result)) throw new Error("GitHub returned an invalid collection.");
    items.push(...result);
    if (result.length < 100) return items;
  }
  throw new Error("GitHub collection exceeds the supported pagination limit.");
}

async function tagCommit(api, base, tag) {
  const reference = await optionalGet(api, `${base}/git/ref/tags/${encodeURIComponent(tag)}`);
  if (!reference) return null;
  let object = reference.object;
  const seen = new Set();
  for (let depth = 0; depth < 16; depth += 1) {
    if (!object || !COMMIT_PATTERN.test(object.sha ?? "") || seen.has(object.sha)) {
      throw new Error("The release tag does not resolve to a valid commit.");
    }
    if (object.type === "commit") return object.sha.toLowerCase();
    if (object.type !== "tag") throw new Error("The release tag must reference a Git commit.");
    seen.add(object.sha);
    object = (await api.request("GET", `${base}/git/tags/${object.sha}`)).object;
  }
  throw new Error("The annotated release tag has too many nested tag objects.");
}

function assertMatchingCommit(actual, request) {
  if (actual !== request.commit) {
    throw new Error(`Tag ${request.tag} points to a different commit. Existing tags are never moved.`);
  }
}

function assertOwnedDraft(release, request) {
  if (!release.draft) throw new Error("The release is already published; published releases are never replaced.");
  if (
    !Number.isSafeInteger(release.id) ||
    release.id <= 0 ||
    release.tag_name !== request.tag ||
    release.prerelease !== request.prerelease ||
    typeof release.body !== "string" ||
    !release.body.includes(publicationMarker(request))
  ) {
    throw new Error("The existing draft does not belong to this exact tag, channel, and commit.");
  }
}

function compareStableVersions(left, right) {
  const a = parseReleaseTag(left).version.split("+")[0];
  // Interpret historical tags for comparison without allowing prefixes on new releases.
  const previousTag = typeof right === "string" && right.startsWith("v") ? right.slice(1) : right;
  const b = parseReleaseTag(previousTag).version.split("+")[0];
  if (a.includes("-") || b.includes("-")) throw new Error("Latest stable release has an unexpected prerelease tag.");
  const leftParts = a.split(".").map(BigInt);
  const rightParts = b.split(".").map(BigInt);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] > rightParts[index] ? 1 : -1;
  }
  return 0;
}

async function assertStablePromotion(api, base, request) {
  if (request.prerelease) return;
  const latest = await optionalGet(api, `${base}/releases/latest`);
  if (latest && compareStableVersions(request.version, latest.tag_name) <= 0) {
    throw new Error(
      "A stable release must be newer than the current latest stable release; the update feed cannot move backwards.",
    );
  }
}

function assetMatches(asset, file, { requireDigest = false } = {}) {
  return (
    asset.name === file.name &&
    asset.state === "uploaded" &&
    asset.size === file.bytes.length &&
    (asset.digest ? asset.digest === file.digest : !requireDigest)
  );
}

function assertExpectedAssets(assets) {
  const names = new Set();
  for (const asset of assets) {
    if (
      !ASSET_NAMES.includes(asset.name) ||
      names.has(asset.name) ||
      !Number.isSafeInteger(asset.id) ||
      asset.id <= 0
    ) {
      throw new Error("The draft contains unexpected or duplicate assets; they will not be changed.");
    }
    names.add(asset.name);
  }
}

function loadArtifacts(artifactDirectory, request, repository) {
  const directory = path.resolve(artifactDirectory);
  const info = fs.lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Artifacts must be in a regular directory.");
  const files = ASSET_NAMES.map((name) => {
    const filename = path.join(directory, name);
    const stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Artifact must be a regular file: ${name}`);
    const bytes = fs.readFileSync(filename);
    return {
      name,
      bytes,
      digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      contentType: name.endsWith(".json") ? "application/json" : "application/zip",
    };
  });
  const verified = verifyPackage({
    manifestPath: path.join(directory, "module.json"),
    zipPath: path.join(directory, "module.zip"),
    tag: request.tag,
    repository,
  });
  return {
    files,
    installation: renderInstallationSection({ tag: request.tag, repository, moduleId: verified.manifest.id }),
    changes: renderChangelogSection(verified.changelog),
  };
}

export async function publishRelease({
  version,
  channel,
  commit,
  repository,
  projectRoot = PROJECT_ROOT,
  artifactDirectory = path.join(projectRoot, "artifacts"),
  api,
}) {
  const sourceVersion = readProjectReleaseVersion(projectRoot);
  if (version !== undefined && version !== sourceVersion) {
    throw new Error("Publication version must match src/module.json.version exactly.");
  }
  const request = normalizeReleaseRequest(sourceVersion, channel, commit);
  validateRepository(repository);
  const artifacts = loadArtifacts(artifactDirectory, request, repository);
  api ??= createGitHubApi(process.env.GH_TOKEN);
  const base = `/repos/${repository}`;
  const currentCommit = await tagCommit(api, base, request.tag);
  if (currentCommit) assertMatchingCommit(currentCommit, request);

  const matching = (await listAll(api, `${base}/releases`)).filter((release) => release.tag_name === request.tag);
  if (matching.length > 1) throw new Error("Multiple releases use this tag; publication is ambiguous.");
  let release = matching[0];
  if (release) {
    assertOwnedDraft(release, request);
    if (!currentCommit) throw new Error("The existing draft is missing its associated tag.");
  }
  await assertStablePromotion(api, base, request);

  if (!currentCommit) {
    try {
      await api.request("POST", `${base}/git/refs`, { json: { ref: `refs/tags/${request.tag}`, sha: request.commit } });
    } catch (error) {
      if (error.status !== 422) throw error;
      assertMatchingCommit(await tagCommit(api, base, request.tag), request);
    }
  }
  if (!release) {
    const body = updateReleaseBody(publicationMarker(request) + "\n", artifacts.installation, artifacts.changes);
    release = await api.request("POST", `${base}/releases`, {
      json: {
        tag_name: request.tag,
        target_commitish: request.commit,
        name: request.tag,
        body,
        draft: true,
        prerelease: request.prerelease,
        make_latest: "false",
      },
    });
    assertOwnedDraft(release, request);
  }

  const assetPath = `${base}/releases/${release.id}/assets`;
  const existingAssets = await listAll(api, assetPath);
  assertExpectedAssets(existingAssets);
  for (const file of artifacts.files) {
    const existing = existingAssets.find((asset) => asset.name === file.name);
    if (existing && assetMatches(existing, file, { requireDigest: true })) continue;
    if (existing) await api.request("DELETE", `${base}/releases/assets/${existing.id}`);
    const uploaded = await api.request("POST", `${assetPath}?name=${encodeURIComponent(file.name)}`, {
      upload: true,
      body: file.bytes,
      contentType: file.contentType,
    });
    if (!assetMatches(uploaded, file))
      throw new Error(`GitHub did not confirm the expected uploaded asset: ${file.name}`);
  }

  const confirmedAssets = await listAll(api, assetPath);
  assertExpectedAssets(confirmedAssets);
  if (
    confirmedAssets.length !== artifacts.files.length ||
    artifacts.files.some((file) => !confirmedAssets.some((asset) => assetMatches(asset, file)))
  ) {
    throw new Error("Both expected assets must be confirmed before the draft can be published.");
  }
  assertMatchingCommit(await tagCommit(api, base, request.tag), request);
  const freshRelease = await api.request("GET", `${base}/releases/${release.id}`);
  assertOwnedDraft(freshRelease, request);
  await assertStablePromotion(api, base, request);
  const published = await api.request("PATCH", `${base}/releases/${release.id}`, {
    json: {
      body: updateReleaseBody(freshRelease.body, artifacts.installation, artifacts.changes),
      draft: false,
      prerelease: request.prerelease,
      make_latest: request.prerelease ? "false" : "true",
    },
  });
  if (published.draft || published.tag_name !== request.tag || published.prerelease !== request.prerelease) {
    throw new Error("GitHub did not confirm the expected published release state.");
  }
  return {
    ...request,
    releaseId: published.id,
    url: published.html_url ?? `https://github.com/${repository}/releases/tag/${encodeURIComponent(request.tag)}`,
    assets: confirmedAssets.map(({ name, size, digest }) => ({ name, size, digest })),
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      version: { type: "string" },
      channel: { type: "string" },
      commit: { type: "string" },
      repository: { type: "string" },
      artifacts: { type: "string", default: "artifacts" },
    },
  });
  const result = await publishRelease({
    version: values.version,
    channel: values.channel,
    commit: values.commit,
    repository: values.repository ?? process.env.GITHUB_REPOSITORY,
    artifactDirectory: path.resolve(PROJECT_ROOT, values.artifacts),
  });
  console.log(`Published ${result.tag} at ${result.commit}: ${result.url}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Published ${result.tag}\n\n[Open the ${result.channel}](${result.url}).\n\nTag commit: \`${result.commit}\`.\n`,
    );
  }
}

if (isMain(import.meta.url)) void main().catch(reportError);

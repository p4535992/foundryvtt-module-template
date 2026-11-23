import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { PROJECT_ROOT } from "../build/config.js";
import { packageExistingDirectory } from "../build/release.js";
import { normalizeReleaseRequest, publicationMarker, publishRelease } from "../build/publish-release.js";

const REPOSITORY = "example-owner/publication-fixture";
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const OTHER_COMMIT = "89abcdef0123456789abcdef0123456789abcdef";
const VERSION = "14.0.1";
const PREFIX = `/repos/${REPOSITORY}`;

function artifactFixture(t, version = VERSION) {
  const temporary = path.join(PROJECT_ROOT, ".test-tmp");
  fs.mkdirSync(temporary, { recursive: true });
  const root = fs.mkdtempSync(path.join(temporary, "publication-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const moduleDirectory = path.join(root, "publication-fixture");
  const artifactDirectory = path.join(root, "artifacts");
  const manifest = {
    id: "publication-fixture",
    title: "Publication Fixture",
    version,
    compatibility: { minimum: "14" },
    esmodules: ["module.js"],
    styles: ["styles/module.css"],
    languages: [{ lang: "en", name: "English", path: "lang/en.json" }],
    packs: [],
  };
  const files = {
    "module.json": JSON.stringify(manifest),
    "module.js": "export const fixture = true;\n",
    "styles/module.css": ".publication-fixture { display: block; }\n",
    "lang/en.json": "{}\n",
    "README.md": "# Publication Fixture\n",
    "CHANGELOG.md": `# Changelog\n\n## [${version}] - 2026-11-19\n\n### Added\n\n- Add the publication fixture.\n`,
    LICENSE: "MIT License\n",
    "THIRD_PARTY_NOTICES.md": "# Third-party notices\n",
  };
  for (const [filename, content] of Object.entries(files)) {
    const absolute = path.join(moduleDirectory, filename);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content);
  }
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "module.json"), JSON.stringify(manifest));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: manifest.id, version }));
  packageExistingDirectory({ moduleDirectory, artifactDirectory, tag: version, repository: REPOSITORY });
  return { version, channel: "stable", commit: COMMIT, repository: REPOSITORY, artifactDirectory, projectRoot: root };
}

function missing() {
  const error = new Error("Not found");
  error.status = 404;
  return error;
}

function digest(bytes) {
  return "sha256:" + createHash("sha256").update(bytes).digest("hex");
}

function assetFromFixture(input, name, id) {
  const bytes = fs.readFileSync(path.join(input.artifactDirectory, name));
  return { id, name, state: "uploaded", size: bytes.length, digest: digest(bytes) };
}

function ownedDraft(input, overrides = {}) {
  const request = normalizeReleaseRequest(input.version, input.channel, input.commit);
  return {
    id: 101,
    tag_name: request.tag,
    name: request.tag,
    target_commitish: request.commit,
    draft: true,
    prerelease: request.prerelease,
    body: publicationMarker(request) + "\n\nKeep these manually written notes.\n",
    html_url: `https://github.com/${REPOSITORY}/releases/tag/${request.tag}`,
    ...overrides,
  };
}

function fakeApi({
  tag,
  annotatedTags = {},
  releases = [],
  assets = [],
  latest,
  latestAfterUploads,
  failUploadAt,
  corruptAsset,
  publishBeforeFinalGuard = false,
} = {}) {
  const calls = [];
  const state = {
    tag: tag ? structuredClone(tag) : null,
    releases: structuredClone(releases),
    assets: structuredClone(assets),
    uploads: 0,
    publishedWith: null,
  };
  const api = {
    async request(method, requestPath, options = {}) {
      calls.push({ method, path: requestPath, options });
      const url = new URL(requestPath, "https://stub.invalid");
      const route = url.pathname;
      if (method === "GET" && route.startsWith(`${PREFIX}/git/ref/tags/`)) {
        if (!state.tag) throw missing();
        return structuredClone(state.tag);
      }
      if (method === "GET" && route.startsWith(`${PREFIX}/git/tags/`)) {
        const sha = route.slice(`${PREFIX}/git/tags/`.length);
        if (!annotatedTags[sha]) throw missing();
        return structuredClone(annotatedTags[sha]);
      }
      if (method === "GET" && route === `${PREFIX}/releases/latest`) {
        if (state.uploads > 0 && latestAfterUploads) return structuredClone(latestAfterUploads);
        if (!latest) throw missing();
        return structuredClone(latest);
      }
      if (method === "GET" && route === `${PREFIX}/releases`) {
        return Number(url.searchParams.get("page") ?? 1) === 1 ? structuredClone(state.releases) : [];
      }
      if (method === "GET" && route === `${PREFIX}/releases/101`) {
        const release = state.releases.find((release) => release.id === 101);
        if (!release) throw missing();
        if (publishBeforeFinalGuard) release.draft = false;
        return structuredClone(release);
      }
      if (method === "POST" && route === `${PREFIX}/git/refs`) {
        assert.equal(state.tag, null, "An existing tag must never be overwritten.");
        state.tag = { ref: options.json.ref, object: { type: "commit", sha: options.json.sha } };
        return structuredClone(state.tag);
      }
      if (method === "POST" && route === `${PREFIX}/releases`) {
        assert.equal(options.json.draft, true, "A release must start as a draft.");
        assert.equal(options.json.make_latest, "false");
        const release = {
          ...options.json,
          id: 101,
          html_url: `https://github.com/${REPOSITORY}/releases/tag/${options.json.tag_name}`,
        };
        state.releases.push(release);
        return structuredClone(release);
      }
      if (method === "GET" && route === `${PREFIX}/releases/101/assets`) {
        return Number(url.searchParams.get("page") ?? 1) === 1 ? structuredClone(state.assets) : [];
      }
      if (method === "DELETE" && route.startsWith(`${PREFIX}/releases/assets/`)) {
        const id = Number(route.slice(`${PREFIX}/releases/assets/`.length));
        assert.ok(state.assets.some((asset) => asset.id === id));
        state.assets = state.assets.filter((asset) => asset.id !== id);
        return undefined;
      }
      if (method === "POST" && route === `${PREFIX}/releases/101/assets`) {
        state.uploads += 1;
        assert.equal(options.upload, true);
        assert.ok(Buffer.isBuffer(options.body));
        assert.ok(options.contentType);
        if (state.uploads === failUploadAt) throw new Error("Simulated asset upload failure");
        const name = url.searchParams.get("name");
        const asset = {
          id: 200 + state.uploads,
          name,
          state: "uploaded",
          size: options.body.length,
          digest: digest(options.body),
        };
        if (corruptAsset) Object.assign(asset, corruptAsset);
        state.assets.push(asset);
        return structuredClone(asset);
      }
      if (method === "PATCH" && route === `${PREFIX}/releases/101`) {
        state.publishedWith = structuredClone(state.assets);
        const release = state.releases.find((release) => release.id === 101);
        Object.assign(release, options.json);
        return structuredClone(release);
      }
      assert.fail(`Unexpected fake API request: ${method} ${requestPath}`);
    },
  };
  return { api, calls, state, mutations: () => calls.filter((call) => call.method !== "GET") };
}

test("publication request normalization separates channels and accepts only pinned full commits", () => {
  assert.deepEqual(normalizeReleaseRequest(VERSION, "stable", COMMIT.toUpperCase()), {
    version: VERSION,
    tag: VERSION,
    channel: "stable",
    commit: COMMIT,
    prerelease: false,
  });
  assert.equal(normalizeReleaseRequest("14.0.1-rc.1", "prerelease", "a".repeat(64)).prerelease, true);
  assert.equal(normalizeReleaseRequest("14.0.1+build-dev", "stable", COMMIT).prerelease, false);
  for (const [version, channel, commit] of [
    ["v14.0.1", "stable", COMMIT],
    ["v14.0.1-rc.1", "prerelease", COMMIT],
    ["14.0.1-rc.1", "stable", COMMIT],
    [VERSION, "prerelease", COMMIT],
    [VERSION, "preview", COMMIT],
    ["014.0.1", "stable", COMMIT],
    ["14.0.1-01", "prerelease", COMMIT],
    [VERSION, "stable", "main"],
    [VERSION, "stable", COMMIT.slice(0, 7)],
    [VERSION, "stable", "g".repeat(40)],
  ]) {
    assert.throws(() => normalizeReleaseRequest(version, channel, commit));
  }
});

test("missing tags are created at the selected commit and publication follows both verified assets", async (t) => {
  const input = artifactFixture(t);
  const stub = fakeApi({ latest: { tag_name: "14.0.0" } });
  const result = await publishRelease({ ...input, api: stub.api });
  assert.equal(result.tag, VERSION);
  assert.equal(result.commit, COMMIT);
  assert.equal(result.prerelease, false);
  const mutations = stub.mutations();
  assert.deepEqual(mutations[0].options.json, { ref: `refs/tags/${VERSION}`, sha: COMMIT });
  assert.equal(mutations[1].options.json.tag_name, VERSION);
  assert.equal(mutations[1].options.json.target_commitish, COMMIT);
  assert.equal(mutations[1].options.json.draft, true);
  assert.equal(mutations.at(-1).method, "PATCH");
  assert.equal(mutations.at(-1).options.json.draft, false);
  assert.equal(mutations.at(-1).options.json.make_latest, "true");
  assert.deepEqual(stub.state.publishedWith.map((asset) => asset.name).sort(), ["module.json", "module.zip"]);
  for (const asset of stub.state.publishedWith) {
    const expected = assetFromFixture(input, asset.name, asset.id);
    assert.deepEqual(asset, expected);
  }
  const lastUpload = stub.calls.findLastIndex((call) => call.method === "POST" && call.options.upload);
  const confirmation = stub.calls.findLastIndex((call) => call.method === "GET" && call.path.includes("/101/assets"));
  const publication = stub.calls.findIndex((call) => call.method === "PATCH");
  assert.ok(lastUpload < confirmation && confirmation < publication);
  const manifestUpload = stub.calls.find((call) => call.options.upload && call.path.endsWith("?name=module.json"));
  const manifest = JSON.parse(manifestUpload.options.body.toString("utf8"));
  assert.equal(manifest.version, VERSION);
  assert.equal(manifest.download, `https://github.com/${REPOSITORY}/releases/download/${VERSION}/module.zip`);
});

test("publication requires a supplied version before any API request", async (t) => {
  const input = artifactFixture(t);
  delete input.version;
  const stub = fakeApi();
  await assert.rejects(publishRelease({ ...input, api: stub.api }), /release tag is required/iu);
  assert.deepEqual(stub.calls, []);
});

test("publication uses the manually selected version independently of source and package versions", async (t) => {
  for (const [version, channel] of [
    [VERSION, "stable"],
    ["14.0.2-rc.1", "prerelease"],
  ]) {
    await t.test(channel, async (t) => {
      const input = { ...artifactFixture(t, version), channel };
      const packageFile = path.join(input.projectRoot, "package.json");
      const sourceFile = path.join(input.projectRoot, "src", "module.json");
      const manifest = JSON.parse(fs.readFileSync(sourceFile, "utf8"));
      const sourceBytes = JSON.stringify({ ...manifest, version: "14.0.0" });
      const packageBytes = JSON.stringify({ version: "14.0.0" });
      fs.writeFileSync(sourceFile, sourceBytes);
      fs.writeFileSync(packageFile, packageBytes);
      const stub = fakeApi();
      const result = await publishRelease({ ...input, api: stub.api });
      assert.equal(result.version, version);
      assert.equal(stub.state.tag.ref, `refs/tags/${version}`);
      assert.equal(stub.state.releases[0].prerelease, channel === "prerelease");
      assert.equal(fs.readFileSync(sourceFile, "utf8"), sourceBytes);
      assert.equal(fs.readFileSync(packageFile, "utf8"), packageBytes);
    });
  }
});

test("a supplied version that disagrees with the verified artifacts fails before any API request", async (t) => {
  const input = artifactFixture(t);
  const stub = fakeApi();
  await assert.rejects(
    publishRelease({ ...input, version: "14.0.2", api: stub.api }),
    /Manifest version does not match the release tag/u,
  );
  assert.deepEqual(stub.calls, []);
});

test("prereleases publish with prerelease enabled and never replace the latest stable release", async (t) => {
  const input = { ...artifactFixture(t, "14.0.2-rc.1"), channel: "prerelease" };
  const stub = fakeApi();
  const result = await publishRelease({ ...input, api: stub.api });
  assert.equal(result.prerelease, true);
  assert.equal(result.tag, "14.0.2-rc.1");
  assert.equal(stub.state.tag.ref, "refs/tags/14.0.2-rc.1");
  const create = stub.calls.find((call) => call.method === "POST" && call.path === `${PREFIX}/releases`);
  const publish = stub.calls.find((call) => call.method === "PATCH");
  assert.equal(create.options.json.tag_name, "14.0.2-rc.1");
  assert.equal(create.options.json.prerelease, true);
  assert.equal(publish.options.json.prerelease, true);
  assert.equal(publish.options.json.make_latest, "false");
  const manifestUpload = stub.calls.find((call) => call.options.upload && call.path.endsWith("?name=module.json"));
  const manifest = JSON.parse(manifestUpload.options.body.toString("utf8"));
  assert.equal(manifest.version, "14.0.2-rc.1");
  assert.equal(manifest.download, `https://github.com/${REPOSITORY}/releases/download/14.0.2-rc.1/module.zip`);
});

test("annotated tags are peeled and a mismatched target fails without any mutation", async (t) => {
  const input = artifactFixture(t);
  const tagObject = "f".repeat(40);
  const stub = fakeApi({
    tag: { object: { type: "tag", sha: tagObject } },
    annotatedTags: { [tagObject]: { object: { type: "commit", sha: OTHER_COMMIT } } },
  });
  await assert.rejects(publishRelease({ ...input, api: stub.api }));
  assert.ok(stub.calls.some((call) => call.path === `${PREFIX}/git/tags/${tagObject}`));
  assert.deepEqual(stub.mutations(), []);
});

test("an already published release is never overwritten, even when its assets are incomplete", async (t) => {
  const input = artifactFixture(t);
  const stub = fakeApi({
    tag: { object: { type: "commit", sha: COMMIT } },
    releases: [ownedDraft(input, { draft: false })],
    assets: [],
  });
  await assert.rejects(publishRelease({ ...input, api: stub.api }));
  assert.deepEqual(stub.mutations(), []);
});

test("a failed second upload leaves an unpublished draft with the successful asset intact", async (t) => {
  const input = artifactFixture(t);
  const stub = fakeApi({ failUploadAt: 2 });
  await assert.rejects(publishRelease({ ...input, api: stub.api }), /Simulated asset upload failure/u);
  assert.equal(stub.state.releases.length, 1);
  assert.equal(stub.state.releases[0].draft, true);
  assert.equal(stub.state.assets.length, 1);
  assert.equal(
    stub.calls.some((call) => call.method === "PATCH"),
    false,
  );
  assert.equal(
    stub.calls.some((call) => call.method === "DELETE"),
    false,
  );
});

test("a draft manually published during asset upload is not patched by the final publication step", async (t) => {
  const input = artifactFixture(t);
  const stub = fakeApi({ publishBeforeFinalGuard: true });
  await assert.rejects(publishRelease({ ...input, api: stub.api }), /already published/u);
  assert.equal(stub.state.assets.length, 2);
  assert.equal(stub.state.releases[0].draft, false);
  assert.equal(
    stub.calls.some((call) => call.method === "PATCH"),
    false,
  );
});

test("an owned draft resumes by preserving matching assets and replacing only stale expected assets", async (t) => {
  const input = artifactFixture(t);
  const manifest = assetFromFixture(input, "module.json", 301);
  const zip = { ...assetFromFixture(input, "module.zip", 302), digest: "sha256:" + "0".repeat(64) };
  const stub = fakeApi({
    tag: { object: { type: "commit", sha: COMMIT } },
    releases: [ownedDraft(input)],
    assets: [manifest, zip],
  });
  await publishRelease({ ...input, api: stub.api });
  assert.deepEqual(
    stub.calls.filter((call) => call.method === "DELETE").map((call) => call.path),
    [`${PREFIX}/releases/assets/302`],
  );
  assert.equal(stub.state.uploads, 1);
  assert.ok(stub.state.publishedWith.some((asset) => asset.id === manifest.id));
  assert.equal(
    stub.calls.some((call) => call.method === "POST" && call.path === `${PREFIX}/releases`),
    false,
  );
  assert.match(stub.state.releases[0].body, /Keep these manually written notes/u);
});

test("foreign drafts and drafts with unexpected assets are refused before mutation", async (t) => {
  for (const scenario of ["foreign marker", "unexpected asset"]) {
    await t.test(scenario, async (t) => {
      const input = artifactFixture(t);
      const draft = ownedDraft(input, scenario === "foreign marker" ? { body: "An unrelated draft." } : {});
      const assets =
        scenario === "unexpected asset" ? [{ id: 303, name: "manual-notes.pdf", size: 3, state: "uploaded" }] : [];
      const stub = fakeApi({ tag: { object: { type: "commit", sha: COMMIT } }, releases: [draft], assets });
      await assert.rejects(publishRelease({ ...input, api: stub.api }));
      assert.deepEqual(stub.mutations(), []);
    });
  }
});

test("asset verification failure never makes the draft public", async (t) => {
  for (const corruption of [{ state: "starter" }, { size: 1 }, { digest: "sha256:" + "0".repeat(64) }]) {
    await t.test(JSON.stringify(corruption), async (t) => {
      const input = artifactFixture(t);
      const stub = fakeApi({ corruptAsset: corruption });
      await assert.rejects(publishRelease({ ...input, api: stub.api }));
      assert.equal(stub.state.releases[0].draft, true);
      assert.equal(
        stub.calls.some((call) => call.method === "PATCH"),
        false,
      );
    });
  }
});

test("older or equal stable versions fail without changing tags, releases, or assets", async (t) => {
  for (const latest of ["14.0.1", "14.0.2"]) {
    await t.test(latest, async (t) => {
      const input = artifactFixture(t);
      const stub = fakeApi({ latest: { tag_name: latest, draft: false, prerelease: false } });
      await assert.rejects(publishRelease({ ...input, api: stub.api }));
      assert.deepEqual(stub.mutations(), []);
    });
  }
});

test("a newer stable release appearing during uploads prevents final publication", async (t) => {
  const input = artifactFixture(t);
  const stub = fakeApi({
    latest: { tag_name: "14.0.0", draft: false, prerelease: false },
    latestAfterUploads: { tag_name: "14.0.2", draft: false, prerelease: false },
  });
  await assert.rejects(publishRelease({ ...input, api: stub.api }), /newer than the current latest/u);
  assert.equal(stub.state.assets.length, 2);
  assert.equal(stub.state.releases[0].draft, true);
  assert.equal(stub.calls.filter((call) => call.path === `${PREFIX}/releases/latest`).length, 2);
  assert.equal(
    stub.calls.some((call) => call.method === "PATCH"),
    false,
  );
});

test("legacy prefixed latest releases are compared without adding prefixes to new tags", async (t) => {
  const input = artifactFixture(t);
  const older = fakeApi({ latest: { tag_name: "v14.0.0", draft: false, prerelease: false } });
  const result = await publishRelease({ ...input, api: older.api });
  assert.equal(result.tag, VERSION);
  assert.equal(older.state.tag.ref, `refs/tags/${VERSION}`);

  const same = fakeApi({ latest: { tag_name: "v14.0.1", draft: false, prerelease: false } });
  await assert.rejects(publishRelease({ ...input, api: same.api }), /newer than the current latest/u);
  assert.deepEqual(same.mutations(), []);
});

test("invalid local artifacts are rejected before any API request", async (t) => {
  const input = artifactFixture(t);
  fs.writeFileSync(path.join(input.artifactDirectory, "module.zip"), "invalid archive");
  const stub = fakeApi();
  await assert.rejects(publishRelease({ ...input, api: stub.api }));
  assert.deepEqual(stub.calls, []);
});

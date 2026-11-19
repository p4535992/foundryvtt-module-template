import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { PROJECT_ROOT, isMain } from "../build/config.js";

const UPSTREAM_REPOSITORY = "DFreds/dfreds-module-template-ts";
const ALLOWED_FILES = new Set([
    "LICENSE",
    "README.md",
    "package.json",
    "vite.config.ts",
    "static/lib/shim.ts",
    ".github/workflows/release.yml",
    ".github/workflows/publish.yml",
    "src/ts/module.ts",
    "src/ts/hooks/index.ts",
    "src/ts/hooks/init.ts",
    "src/ts/hooks/setup.ts",
    "src/ts/hooks/hot-reload.ts",
    "src/ts/settings.ts",
    "src/ts/logger.ts",
    "src/ts/handlebar-helpers.ts",
    "src/ts/constants.ts",
    "src/ts/api.ts",
    "static/module.json",
    "build/clean.ts",
    "build/link-foundry.ts",
    "build/rename-module.ts",
    "build/pack.ts",
    "build/unpack.ts",
    "build/util/packs.ts",
    "build/start-foundry.ts",
    "foundryconfig.example.json",
]);

export function readUpstreamBaseline(filename = path.join(PROJECT_ROOT, "upstream.json")) {
    const baseline = JSON.parse(fs.readFileSync(filename, "utf8"));
    if (
        baseline.schemaVersion !== 1 ||
        baseline.repository !== UPSTREAM_REPOSITORY ||
        baseline.ref !== "main" ||
        !Array.isArray(baseline.files)
    ) {
        throw new Error("Unsupported upstream baseline.");
    }
    const seen = new Set();
    for (const file of baseline.files) {
        if (!ALLOWED_FILES.has(file.path) || seen.has(file.path) || !/^[a-f0-9]{40}$/u.test(file.gitBlobSha)) {
            throw new Error("Invalid or duplicate upstream file baseline: " + file.path);
        }
        seen.add(file.path);
    }
    if (seen.size !== ALLOWED_FILES.size) throw new Error("The upstream baseline must include the complete reviewed file allowlist.");
    return baseline;
}

export async function compareUpstream({ baseline = readUpstreamBaseline(), fetchImplementation = fetch } = {}) {
    const token = process.env.GITHUB_TOKEN;
    const headers = {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "foundryvtt-module-template-upstream-check",
        ...(token ? { Authorization: "Bearer " + token } : {}),
    };
    const results = [];
    for (const file of baseline.files) {
        if (!ALLOWED_FILES.has(file.path) || baseline.repository !== UPSTREAM_REPOSITORY || baseline.ref !== "main") {
            throw new Error("Upstream request is outside the approved file allowlist.");
        }
        const encodedPath = file.path.split("/").map(encodeURIComponent).join("/");
        const url =
            "https://api.github.com/repos/" +
            UPSTREAM_REPOSITORY +
            "/contents/" +
            encodedPath +
            "?ref=main";
        const response = await fetchImplementation(url, {
            headers,
            redirect: "error",
            signal: AbortSignal.timeout(15000),
        });
        if (response.status === 404) {
            results.push({ path: file.path, status: "removed", previous: file.gitBlobSha });
            continue;
        }
        if (!response.ok) throw new Error("GitHub returned HTTP " + response.status + " for " + file.path + ".");
        const current = await response.json();
        if (current.type !== "file" || current.path !== file.path || !/^[a-f0-9]{40}$/u.test(current.sha)) {
            throw new Error("Unexpected GitHub file response for " + file.path + ".");
        }
        results.push({
            path: file.path,
            status: current.sha === file.gitBlobSha ? "unchanged" : "changed",
            previous: file.gitBlobSha,
            current: current.sha,
            url: "https://github.com/" + UPSTREAM_REPOSITORY + "/blob/main/" + encodedPath,
        });
    }
    return results;
}

async function main() {
    const { values } = parseArgs({
        options: {
            offline: { type: "boolean", default: false },
            json: { type: "boolean", default: false },
        },
    });
    const baseline = readUpstreamBaseline();
    if (values.offline) {
        console.log("Validated " + baseline.files.length + " upstream file baselines without network access.");
        return;
    }
    const results = await compareUpstream({ baseline });
    if (values.json) console.log(JSON.stringify(results, null, 2));
    else {
        console.log("Manual source-file comparison against " + UPSTREAM_REPOSITORY + " (main):");
        for (const item of results) console.log(item.status.padEnd(10) + " " + item.path);
        console.log("No local files were modified. Review changed files before updating the baseline.");
    }
    if (results.some((item) => item.status !== "unchanged")) process.exitCode = 2;
}

if (isMain(import.meta.url)) {
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}

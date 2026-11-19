import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { PROJECT_ROOT, readManifest, isMain } from "./config.js";
import { encodeZip } from "./zip.js";
import {
    collectModuleFiles,
    extractChangelogEntry,
    parseReleaseTag,
    releaseUrls,
    validateModuleId,
    verifyModuleFiles,
    verifyPackage,
} from "./verify-package.js";

export const INSTALL_SECTION_START = "<!-- foundry-module-template:installation:start -->";
export const INSTALL_SECTION_END = "<!-- foundry-module-template:installation:end -->";
export const CHANGELOG_SECTION_START = "<!-- foundry-module-template:changelog:start -->";
export const CHANGELOG_SECTION_END = "<!-- foundry-module-template:changelog:end -->";
const ARTIFACT_NAMES = ["module.json", "module.zip", "install-section.md", "changelog-section.md"];

function prepareArtifactDirectory(directory, moduleDirectory) {
    const output = path.resolve(directory);
    if (moduleDirectory) {
        const relative = path.relative(path.resolve(moduleDirectory), output);
        if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
            throw new Error("Release artifacts must be outside the module directory.");
        }
    }
    if (output === PROJECT_ROOT || output === path.parse(output).root) {
        throw new Error("Use a dedicated artifacts directory.");
    }
    for (const name of ["src", "build", "utils", "wiki", ".github", ".git"]) {
        const relative = path.relative(path.join(PROJECT_ROOT, name), output);
        if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
            throw new Error("Artifacts must not replace project source files.");
        }
    }
    if (fs.existsSync(output) && fs.lstatSync(output).isSymbolicLink()) {
        throw new Error("Artifacts directory cannot be a symbolic link.");
    }
    fs.mkdirSync(output, { recursive: true });
    for (const name of ARTIFACT_NAMES) {
        const filename = path.join(output, name);
        if (fs.existsSync(filename) || (() => {
            try {
                return fs.lstatSync(filename).isSymbolicLink();
            } catch {
                return false;
            }
        })()) {
            const stat = fs.lstatSync(filename);
            if (stat.isDirectory()) throw new Error("Artifact filename is occupied by a directory: " + name);
            fs.unlinkSync(filename);
        }
    }
    return output;
}

function writeAtomic(filename, bytes) {
    const temporary = filename + "." + process.pid + "." + randomUUID() + ".tmp";
    try {
        fs.writeFileSync(temporary, bytes, { flag: "wx" });
        fs.renameSync(temporary, filename);
    } finally {
        fs.rmSync(temporary, { force: true });
    }
}

export function renderInstallationSection({ tag, repository, moduleId }) {
    validateModuleId(moduleId);
    const { version } = parseReleaseTag(tag);
    const urls = releaseUrls(repository, tag);
    const tokens = {
        MODULE_ID: moduleId,
        VERSION: version,
        TAG: tag,
        MANIFEST_URL: urls.attachedManifest,
        DOWNLOAD_URL: urls.download,
        LATEST_RELEASE_URL: urls.latestRelease,
        UPDATE_MANIFEST_URL: urls.manifest,
    };
    let text = fs.readFileSync(path.join(PROJECT_ROOT, ".github", "RELEASE_TEMPLATE.md"), "utf8");
    for (const [key, value] of Object.entries(tokens)) text = text.replaceAll("{{" + key + "}}", value);
    if (/\{\{[A-Z_]+\}\}/u.test(text)) throw new Error("Release template contains an unknown placeholder.");
    if (!text.includes(INSTALL_SECTION_START) || !text.includes(INSTALL_SECTION_END)) {
        throw new Error("Release template must contain the managed installation section markers.");
    }
    return text.trimEnd();
}

export function renderChangelogSection(entry) {
    return [
        CHANGELOG_SECTION_START,
        "## Changes in " + entry.version,
        "",
        "Changelog date: " + entry.date + ".",
        "",
        entry.body,
        CHANGELOG_SECTION_END,
    ].join("\n");
}

function replaceManagedSection(existingBody, section, startMarker, endMarker) {
    const body = existingBody ?? "";
    if (typeof body !== "string") throw new Error("Existing release body must be a string.");
    const start = body.indexOf(startMarker);
    const end = body.indexOf(endMarker);
    if (start === -1 && end === -1) {
        const separator = !body || body.endsWith("\n\n") ? "" : body.endsWith("\n") ? "\n" : "\n\n";
        return body + separator + section + "\n";
    }
    if (
        start < 0 ||
        end < start ||
        body.indexOf(startMarker, start + startMarker.length) !== -1 ||
        body.indexOf(endMarker, end + endMarker.length) !== -1
    ) {
        throw new Error("Release body has ambiguous generated-section markers; preserve it and fix the markers manually.");
    }
    return body.slice(0, start) + section + body.slice(end + endMarker.length);
}

export function updateReleaseBody(existingBody, installationSection, changelogSection) {
    const body = changelogSection
        ? replaceManagedSection(existingBody, changelogSection, CHANGELOG_SECTION_START, CHANGELOG_SECTION_END)
        : existingBody;
    return replaceManagedSection(body, installationSection, INSTALL_SECTION_START, INSTALL_SECTION_END);
}

/**
 * Package an already-built module without running Vite or touching its source
 * manifest. This is also the dependency-free entry point used by fixture tests.
 */
export function packageExistingDirectory({ moduleDirectory, artifactDirectory, tag, repository }) {
    const { version } = parseReleaseTag(tag);
    const urls = releaseUrls(repository, tag);
    const output = prepareArtifactDirectory(artifactDirectory, moduleDirectory);
    const files = collectModuleFiles(moduleDirectory);
    if (!files.has("module.json")) throw new Error("Built module.json is missing.");
    const manifest = JSON.parse(files.get("module.json").toString("utf8"));
    validateModuleId(manifest.id);
    Object.assign(manifest, {
        version,
        url: urls.repositoryUrl,
        manifest: urls.manifest,
        download: urls.download,
    });
    const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 4) + "\n");
    files.set("module.json", manifestBytes);
    const { changelog } = verifyModuleFiles(files, { tag, repository, release: true });
    const archiveFiles = new Map([...files].map(([name, bytes]) => [manifest.id + "/" + name, bytes]));
    const zipBytes = encodeZip(archiveFiles);
    const manifestPath = path.join(output, "module.json");
    const zipPath = path.join(output, "module.zip");
    try {
        writeAtomic(manifestPath, manifestBytes);
        writeAtomic(zipPath, zipBytes);
        verifyPackage({ manifestPath, zipPath, tag, repository });
        const section = renderInstallationSection({ tag, repository, moduleId: manifest.id });
        writeAtomic(path.join(output, "install-section.md"), section + "\n");
        writeAtomic(path.join(output, "changelog-section.md"), renderChangelogSection(changelog) + "\n");
    } catch (error) {
        for (const name of ARTIFACT_NAMES) fs.rmSync(path.join(output, name), { force: true });
        throw error;
    }
    return { manifest, manifestPath, zipPath, fileCount: files.size };
}

function runNodeScript(script, args) {
    const result = spawnSync(process.execPath, [path.join(PROJECT_ROOT, script), ...args], {
        cwd: PROJECT_ROOT,
        stdio: "inherit",
        shell: false,
        env: process.env,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(script + " failed; release artifacts were not produced.");
}

export function prepareRelease({ tag, repository, artifactDirectory = path.join(PROJECT_ROOT, "artifacts"), keepStage = false }) {
    parseReleaseTag(tag);
    releaseUrls(repository, tag);
    const manifest = readManifest();
    validateModuleId(manifest.id);
    const output = prepareArtifactDirectory(artifactDirectory);
    extractChangelogEntry(fs.readFileSync(path.join(PROJECT_ROOT, "CHANGELOG.md"), "utf8"), tag);
    const stageParent = path.join(PROJECT_ROOT, ".release-stage");
    if (fs.existsSync(stageParent) && fs.lstatSync(stageParent).isSymbolicLink()) {
        throw new Error("Release staging directory cannot be a symbolic link.");
    }
    fs.mkdirSync(stageParent, { recursive: true });
    const stage = fs.mkdtempSync(path.join(stageParent, "release-"));
    try {
        runNodeScript("build/build.js", ["--out-root", stage, "--mode", "production"]);
        if ((manifest.packs ?? []).length) {
            runNodeScript("utils/packs.js", ["pack", "--out-root", stage]);
        }
        const result = packageExistingDirectory({
            moduleDirectory: path.join(stage, manifest.id),
            artifactDirectory: output,
            tag,
            repository,
        });
        if (keepStage) console.log("Kept release staging directory: " + stage);
        return result;
    } finally {
        if (!keepStage) fs.rmSync(stage, { recursive: true, force: true });
    }
}

function main() {
    const { values } = parseArgs({
        options: {
            tag: { type: "string" },
            repository: { type: "string" },
            artifacts: { type: "string" },
            "keep-stage": { type: "boolean", default: false },
        },
    });
    const environmentTag =
        process.env.RELEASE_TAG ??
        (process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : undefined);
    const result = prepareRelease({
        tag: values.tag ?? environmentTag,
        repository: values.repository ?? process.env.GITHUB_REPOSITORY,
        artifactDirectory: values.artifacts ? path.resolve(PROJECT_ROOT, values.artifacts) : undefined,
        keepStage: values["keep-stage"],
    });
    console.log("Prepared " + result.manifest.id + " " + result.manifest.version + " (" + result.fileCount + " files).");
    console.log(result.manifestPath);
    console.log(result.zipPath);
}

if (isMain(import.meta.url)) {
    try {
        main();
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}

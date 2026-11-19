# Releasing a module

The manual release workflows create the version tag and publish two installable assets: **module.json** and **module.zip**. The ZIP contains one top-level directory named after the module id. Stable releases and prereleases have separate workflows and share the same verified packaging process.

## Prepare and verify locally

Use the Node.js version recorded in .nvmrc and install the locked dependencies with `npm ci`.

Before preparing a release, set the same unprefixed semantic version in src/module.json, package.json, and the literal MODULE_VERSION in src/scripts/constants.js. The workflows read src/module.json.version automatically and require all three version values to agree exactly. Curate the relevant changes from Unreleased into a dated section matching that version:

```markdown
## [14.0.0] - YYYY-MM-DD

### Added

- Describe a meaningful change included in this release.
```

Replace YYYY-MM-DD with the intended release date. Keep the Unreleased heading for future work. The initial 14.0.0 entry is dated 2026-11-19; subsequent releases need their own curated version section. Preparing a version without its own valid, nonempty section fails clearly.

Use only the relevant categories: Added, Changed, Deprecated, Removed, Fixed, and Security. Omit empty categories. Each included category needs an actual list item; TODO, TBD, and empty placeholders are rejected. A prerelease such as 14.0.1-rc.1 needs its own `[14.0.1-rc.1]` entry and the same prerelease version in all three identity files; it does not borrow the final version's entry.

Then run:

```sh
npm run check
npm run release:prepare -- --repository your-account/example-module
npm run verify:package -- --artifacts artifacts --tag 14.0.0 --repository your-account/example-module
```

Replace the example repository and verification tag after creating your own module. The local release:prepare command reads the source version automatically when `--tag` is omitted; an explicit tag must match that version exactly. Use strict, unprefixed semantic versions throughout: the source version `14.0.0` produces tag `14.0.0`, generated `module.json.version` value `14.0.0`, and a download URL containing that exact tag. A leading `v` is rejected rather than normalized. The manual workflows have no version input.

The release command creates a fresh temporary directory beneath .release-stage/, builds there, and packages that result. It does not package an existing development dist/ directory. If the manifest declares compendiums, it compiles them from packs-src/ into that same isolated output; a declared pack without source data fails the release.

The generated files are:

```text
artifacts/
  module.json
  module.zip
  install-section.md
  changelog-section.md
```

Only module.json and module.zip become release assets. install-section.md and changelog-section.md supply the two managed sections of the release description. The complete CHANGELOG.md is also included inside the module ZIP.

The packaging step preserves the source manifest and its version while generating release URLs in memory. The separately attached manifest is byte-identical to the one in the ZIP. Existing generated artifacts with these names are removed before a new preparation, so a failed build does not leave an older module.zip ready for accidental upload.

## Manifest URLs

For the example tag 14.0.0:

| Field or link          | Value                                                                    |
| ---------------------- | ------------------------------------------------------------------------ |
| Attached manifest      | https://github.com/OWNER/REPOSITORY/releases/download/14.0.0/module.json |
| `download`             | https://github.com/OWNER/REPOSITORY/releases/download/14.0.0/module.zip  |
| `manifest` update feed | https://github.com/OWNER/REPOSITORY/releases/latest/download/module.json |
| Latest stable release  | https://github.com/OWNER/REPOSITORY/releases/latest                      |

The attached stable manifest installs the ZIP belonging to its exact release. Its update feed lets Foundry discover the latest stable version later.

A prerelease such as 14.0.1-rc.1 uses its own attached manifest URL as the `manifest` field: https://github.com/OWNER/REPOSITORY/releases/download/14.0.1-rc.1/module.json. Both its manifest and ZIP remain pinned to that prerelease. Install the attached manifest of another prerelease explicitly to test it; there is no automatically moving prerelease feed. Publishing a prerelease leaves the latest stable release unchanged.

## Create a stable release

1. Set src/module.json.version, package.json.version, and MODULE_VERSION in src/scripts/constants.js to the same stable version, such as `14.0.0`. Commit those files, the intended module changes, and the exact dated CHANGELOG.md entry to the branch you want to release.
2. Open **Actions → Create Release → Run workflow** and select that branch.
3. Run the workflow. It reads the version from src/module.json; there is no version field to fill in.

The workflow rejects versions containing a prerelease suffix, a leading `v`, or a mismatch between the three identity files. It records the selected branch's commit at dispatch, checks out that exact SHA, installs locked dependencies, runs the project checks, builds in isolated staging, and verifies the archive. An existing tag or release is not required. After validation succeeds, publication creates `14.0.0` at that verified commit, prepares a draft release, uploads module.json and module.zip, and publishes the completed release last.

## Create a prerelease

Use **Actions → Create Prerelease → Run workflow** for testing versions. First set src/module.json.version, package.json.version, and the literal MODULE_VERSION in src/scripts/constants.js to the same unprefixed version with a prerelease suffix, such as `14.0.1-rc.1`, and commit an exact dated `[14.0.1-rc.1]` changelog entry. Choose that branch and run the workflow without entering a version. A stable version, a leading `v`, or mismatched source versions are rejected.

The prerelease workflow follows the same checks and publication order, creates the exact tag `14.0.1-rc.1`, and marks the GitHub release as a prerelease. It does not promote the release to latest stable. Share that prerelease's attached module.json URL with testers.

## Publication guarantees and reruns

Both manual workflows call .github/workflows/publish.yml. The build job has read-only repository permissions. It passes the four verified files to a separate publication job through an artifact identified by its exact artifact ID; the download fails on an artifact digest mismatch. Only the publication job has contents write permission, and GH_TOKEN is exposed only to the publication helper. That job does not install dependencies or run npm scripts. No personal access token, Discord secret, or Foundry publication secret is required.

The helper checks the source version, channel, commit, and package again before publication. Publication jobs are serialized across the repository, while independent builds can run in parallel. An existing tag is accepted only if it already points to that exact commit; tags are never moved. An existing published release is refused, so rerunning a successful release cannot replace its assets. Publish a new version when code changes. Stable publication also refuses to replace a newer latest stable release with an older version.

An interrupted draft may be resumed only for the same tag, source commit, and release channel. Rerun the original workflow to keep its selected commit. If its temporary build artifact has expired, rerun all jobs to rebuild it. A failure before publication leaves any created release as a draft; it is not exposed as a completed release without its assets. A branch advancing after dispatch does not change the commit being released.

Release publication is manual. Publishing the draft does not start another release workflow. The separate **Check** workflow runs on branch pushes and manual requests. No workflow is triggered by a pull request, a schedule, or an upstream update bot.

## Release description

.github/RELEASE_TEMPLATE.md is the English source for the generated installation instructions. It links to the attached version-specific manifest, the matching ZIP, the latest stable release, and the update feed. It also explains manual extraction into Data/modules/.

The workflow reads the exact version entry from CHANGELOG.md and appends or updates its curated changes section while preparing the draft. It also appends or updates the installation section. These sections use separate markers:

```text
<!-- foundry-module-template:installation:start -->
<!-- foundry-module-template:installation:end -->
<!-- foundry-module-template:changelog:start -->
<!-- foundry-module-template:changelog:end -->
```

Author-written text outside the markers is retained. An incomplete marker pair, duplicated markers, or reversed markers fail the update rather than replacing the description. Keep supplementary notes outside the generated sections; edit version changes in CHANGELOG.md. Release notes are not inferred from Git history or pull requests.

## Package contents and limits

The archive includes the module id directory, runtime JavaScript, compiled styles, translations, templates, assets, optional compiled compendiums, README, CHANGELOG, documentation, and license notices. The verifier checks manifest paths, the top-level directory, both manifest copies, release URLs, CRCs, and ZIP bounds. It rejects source files, source maps, dependency directories, hidden files, unsafe paths, and symbolic links.

The independent ZIP32 implementation uses Node.js and requires no system zip executable. It supports fewer than 65,535 file entries and up to 512 MiB of uncompressed module files. Identical built files produce identical archives under the same Node.js runtime.

Keep LICENSE and THIRD_PARTY_NOTICES.md in every package. Do not mark a Foundry version as `compatibility.verified` until it has been tested in an actual Foundry world. That field is intentionally optional in the starter. Packaging tests do not replace Foundry runtime checks with GM and player clients.

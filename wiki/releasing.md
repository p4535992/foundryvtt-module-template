# Releasing a module

The release workflow creates two installable assets: **module.json** and **module.zip**. The ZIP contains one top-level directory named after the module id.

## Prepare and verify locally

Use the Node.js version recorded in .nvmrc and install the locked dependencies with `npm ci`.

Before preparing a release, curate the relevant changes from Unreleased into a dated section matching its exact version:

```markdown
## [14.0.0] - YYYY-MM-DD

### Added

- Describe a meaningful change included in this release.
```

Replace YYYY-MM-DD with the intended release date. Keep the Unreleased heading for future work. The starter currently has only Unreleased notes: it does not claim that 14.0.0 has been published. Preparing a version without its own valid, nonempty section fails clearly.

Use only the relevant categories: Added, Changed, Deprecated, Removed, Fixed, and Security. Omit empty categories. Each included category needs an actual list item; TODO, TBD, and empty placeholders are rejected. A prerelease such as v14.0.0-rc.1 needs its own `[14.0.0-rc.1]` entry and does not borrow the final version's entry.

Then run:

```sh
npm run check
npm run release:prepare -- --tag v14.0.0 --repository p4535992/foundryvtt-module-template
npm run verify:package -- --artifacts artifacts --tag v14.0.0 --repository p4535992/foundryvtt-module-template
```

Replace the example repository and tag after creating your own module. Tags must be semantic versions, optionally prefixed with `v`. The tag is the release version source; its optional prefix is removed from `module.json.version` and retained in the asset download URL.

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

The packaging step preserves the source manifest and generates release metadata in memory. The separately attached manifest is byte-identical to the one in the ZIP. Existing generated artifacts with these names are removed before a new preparation, so a failed build does not leave an older module.zip ready for accidental upload.

## Manifest URLs

For the example tag v14.0.0:

| Field or link | Value |
| --- | --- |
| Attached manifest | https://github.com/p4535992/foundryvtt-module-template/releases/download/v14.0.0/module.json |
| `download` | https://github.com/p4535992/foundryvtt-module-template/releases/download/v14.0.0/module.zip |
| `manifest` update feed | https://github.com/p4535992/foundryvtt-module-template/releases/latest/download/module.json |
| Latest stable release | https://github.com/p4535992/foundryvtt-module-template/releases/latest |

The attached manifest installs the ZIP belonging to its exact release. Its update feed lets Foundry discover the latest stable version later. Prerelease artifacts remain addressable by their own release tag.

## GitHub workflow

The **Package Release** workflow runs when a release is published. It also supports a manual run with an existing published release tag. Both paths check out `refs/tags/<tag>` and check that the checkout and release identify the same tag.

The workflow installs locked dependencies, runs the project checks, builds in isolated staging, verifies the archive, and attaches module.json and module.zip to that release. A manual rerun replaces those two generated assets. Keep released tags fixed; publish a new version for changed code.

Create the tag and release through your normal, explicit release process. The workflow does not create commits or tags. A published release will briefly exist before its build assets are attached; wait for the packaging job to succeed before sharing its installation manifest.

The workflow uses the repository GITHUB_TOKEN with contents write permission for its release job. GH_TOKEN is exposed only to the steps that read or update release data, not to dependency installation or build commands. It does not need a personal access token or a Discord or Foundry publication secret.

The **Check** workflow runs on branch pushes and manual requests. No workflow is triggered by a pull request, a schedule, or an upstream update bot.

## Release description

.github/RELEASE_TEMPLATE.md is the English source for the generated installation instructions. It links to the attached version-specific manifest, the matching ZIP, the latest stable release, and the update feed. It also explains manual extraction into Data/modules/.

The workflow reads the exact version entry from CHANGELOG.md and appends or updates its curated changes section. It also appends or updates the installation section. These sections use separate markers:

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

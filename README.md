# Foundry VTT Module Template

[![JavaScript](https://img.shields.io/badge/source-JavaScript-f7df1e)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Foundry VTT](https://img.shields.io/badge/Foundry_VTT-v14_target-orange)](https://foundryvtt.com/api/v14/)
[![Vite](https://img.shields.io/badge/build-Vite-646cff)](https://vite.dev/guide/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

A reusable **JavaScript + Vite** foundation for Foundry Virtual Tabletop modules. It combines a small Foundry lifecycle, a settings application, native Foundry 14 remote queries, optional libWrapper integration, development tools, and reproducible release packaging.

The starting module and package version is **14.0.0**, targeting Foundry VTT 14. See [verification](wiki/verification.md) for the automated checks and the remaining Foundry runtime validation.

The project adapts useful features from [DFreds Module Template TS](https://github.com/DFreds/dfreds-module-template-ts) to JavaScript and a single `src/` tree. [Upstream tracking](wiki/upstream.md) records the source-to-local mapping and deliberate differences.

## What is included

- JavaScript ES modules with Vite builds, watch mode, and a development proxy.
- Three explicit identity files, with derived asset paths, translation namespaces, and style scoping.
- `ModuleApi` with readiness, status, settings-window access, and a native `ModuleSocket` service.
- A reusable `ModuleSettingsApplication` for the module's real client debug setting.
- Named remote actions using Foundry 14 `CONFIG.queries`, `User.query`, and `User.queryMany`.
- Optional libWrapper integration with no registered wrappers in a fresh module.
- Targeted renaming, safe Foundry linking, a launcher, and optional compendium tools.
- Release assets named `module.json` and `module.zip`, with the module-id directory inside the archive.
- Separate stable and prerelease workflows, source-driven unprefixed tags, and curated release descriptions.
- Versioned guides in `wiki/`, consistent formatting, and manual upstream source comparison.

The template targets Foundry v14. Set `compatibility.verified` only after testing the derived module in an actual Foundry build. Automated source checks do not establish runtime compatibility.

## Requirements

- Node.js 24, at least 24.14.1. `.nvmrc` selects the Node 24 line.
- npm and the committed `package-lock.json` for reproducible installs.
- A separately installed, licensed Foundry VTT v14 for runtime development and smoke testing.

Foundry runs the generated JavaScript. Node, Vite, Sass, and linting tools are development dependencies.

## Create your module

Create your repository from this project and clone it outside Foundry's data directory.

```sh
nvm use
npm ci
npm run rename-module -- --id example-module --title "Example Module" --version 14.0.0 --description "An example Foundry VTT module." --repository your-account/example-module
```

Only three authored files contain the identity fields that need manual changes:

| File                       | Identity and metadata                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------- |
| `src/module.json`          | Module id, title, version, author information, compatibility, and project URLs                          |
| `package.json`             | Matching package name and version, author information, and repository metadata                          |
| `src/scripts/constants.js` | Literal `MODULE_ID`, `MODULE_TITLE`, and `MODULE_VERSION`; paths and translation keys derive from these |

The module id must match the package name and `MODULE_ID`. The title must match `MODULE_TITLE`, and all three version fields must agree exactly. Keep these constants as exported string literals. The source checker rejects an inconsistent identity, and the rename utility refuses computed constants.

The rename command changes those three files and refreshes the generated root metadata in `package-lock.json`. It does not search and replace unrelated source, documentation, changelog history, or provenance. Use `--dry-run` to review the intended edits. Review author details before publishing. If editing the three files manually, regenerate the lockfile and commit it with the source changes.

Translation source uses the root key `__MODULE_ID__`. Build, watch, and hot mode replace that root structurally with the current id. Vite injects Sass `$module-id` for style scoping. Generic application classes and template filenames do not need renaming.

Copy `foundryconfig.example.json` to `foundryconfig.json` and set your local paths. Its `dataPath` is Foundry's **Data directory**, containing `modules`, `systems`, and `worlds`.

```sh
npm run dev
npm run link
```

The link command connects `dist/<module-id>/` to `Data/modules/<module-id>/`. Enable the module in a test world and reload Foundry. Open its settings window from the browser console using your actual module id:

```js
await game.modules.get("example-module").api.openSettings();
```

See [development](wiki/development.md) and [configuration](wiki/configuration.md) for local setup, identity validation, watch mode, compendiums, and project conventions.

## Source structure

```text
src/
  module.json                 Package metadata and module identity
  module.js                   Styles and lifecycle entry point
  lang/
    en.json                   English strings under __MODULE_ID__
  styles/
    module.scss               Sass styles with injected $module-id
  templates/
    module-settings.hbs       Reusable settings template
  assets/
    module-icon.svg           Original reusable artwork
  scripts/
    constants.js              Literal identity constants and derived paths
    api.js                    ModuleApi class and readiness contract
    module-registry.js        API attachment and guarded runtime socket alias
    socket.js                 ModuleSocket over native Foundry queries
    socket-handlers.js        Named operations and authorization policies
    settings.js               Client debug setting registration and access
    logger.js                 Module-scoped diagnostics
    wrappers.js               Optional libWrapper integration
    hooks/                    init, setup, and ready registration
    applications/
      module-settings.js      ModuleSettingsApplication
    lib/
      libwrapper-shim.js      Attributed optional fallback

build/                        Build, identity validation, and release machinery
utils/                        Node-only developer utilities
tests/                        Built-in Node test runner suites
wiki/                         Configuration, development, runtime, and release guides
.github/workflows/            Checks and explicit publication workflows
.github/RELEASE_TEMPLATE.md    English release installation section
CHANGELOG.md                  Unreleased work and dated version history
foundryconfig.example.json    Portable local configuration example
upstream.json                 Reviewed upstream files and adaptation decisions
vite.config.js                JavaScript Vite configuration
```

`src/` contains the authored runtime and resources. `build/` and `utils/` run in Node and are excluded from the installed module. The package declares `main: "module.js"`; Foundry loads the generated entry listed in `src/module.json.esmodules`.

### Where new functionality belongs

Keep lifecycle handlers short. They register or start components; the actual behavior belongs in the component that owns it.

Small shared services can live in `src/scripts/services/`. Larger features can group their service, hooks, and application under `src/scripts/features/<feature-name>/`. Add these directories when there is real code to put in them.

Keep system-specific assumptions and third-party integrations in dedicated files. Prefer public Foundry APIs and documented hooks. Pass dependencies explicitly when doing so makes the behavior easier to understand or test.

## Lifecycle and public API

The public API is **`game.modules.get(MODULE_ID).api`**. In module source, import `MODULE_ID` from `src/scripts/constants.js`; in the browser console, use the id from your manifest.

`ModuleApi` exposes `id`, `title`, `version`, `ready`, `status`, `error`, `whenReady`, `open()`, `openSettings()`, `getStatus()`, and the canonical `socket` service. Both opening methods display the settings application.

`init` registers the client debug setting, API, and named query handlers. `setup` reads saved settings and configures logging. `ready` preloads the template, activates the socket service, exposes the runtime alias, and resolves `whenReady`. Foundry does not await hook promises, so integrations must observe this readiness contract.

```js
const api = game.modules.get(MODULE_ID).api;
await api.whenReady;
await api.openSettings();

const socket = api.socket;
const status = await socket.executeAsGM("getStatus", {}, { timeout: 5000 });
console.log(status);
```

After readiness, while the service is active, the public convenience path is **`game.modules.get(MODULE_ID).socket`**. It refers to the same instance as `.api.socket`. The latter remains the canonical service path.

Foundry also uses `module.socket` as a manifest boolean. The runtime alias is installed only when the field can be safely replaced without changing manifest serialization. The source manifest retains its boolean; verify `toObject(true)` and `toJSON()` in a real Foundry smoke test. An unsupported field shape fails initialization instead of overwriting an unknown accessor.

### Native socket service

`ModuleSocket` uses [Foundry's registered queries](https://foundryvtt.com/api/v14/variables/CONFIG.queries.html), [User.query and User.queryMany](https://foundryvtt.com/api/v14/classes/foundry.documents.User.html#query), and the [active GM selection](https://foundryvtt.com/api/v14/classes/foundry.documents.collections.Users.html#activeGM). It implements no additional RPC transport and needs no socketlib dependency or fallback.

Register operations in `socket-handlers.js` using `register(action, handler, { authorize })`. Authorization defaults to GM callers. The included `getStatus` operation explicitly permits active users because it returns a read-only status snapshot. Handlers receive the canonical caller through core's query context; payload fields cannot replace that identity. The caller must also have Foundry's `QUERY_USER` permission.

The service provides `executeAsUser`, `executeAsGM`, `executeForUsers`, `executeForEveryone`, and `executeForOthers`. Multi-user calls preserve core's `Map<User, PromiseSettledResult>`, including individual failures. Timeouts bound waiting; do not treat a timeout as cancellation or automatically retry a mutating action.

Socketlib remains a maintained option for other projects, with [Foundry 14 compatibility listed by its maintainer](https://foundryvtt.com/packages/socketlib). Its [current README](https://github.com/farling42/foundryvtt-socketlib/blob/develop/README.md) recommends evaluating native queries for Foundry 14+. This template uses an original native service and does not copy socketlib implementation code.

See [runtime behavior](wiki/runtime.md) for exact signatures, result handling, authorization, lifecycle rules, and multiplayer smoke tests.

### Optional libWrapper integration

The integration is available for features that need to wrap a method. The starter itself does not wrap Foundry methods or require the lib-wrapper module.

For an actual wrapping feature, prefer the real [libWrapper](https://github.com/ruipin/fvtt-lib-wrapper) module and document the dependency policy. The included fallback is deliberately limited and does not promise the full libWrapper API or conflict management. Preserve the wrapped function's return value and its `this` binding.

The fallback retains its original MIT attribution. [Third-party notices](THIRD_PARTY_NOTICES.md) describe the adapted sources and licensing.

## Development commands

| Command                                                               | Purpose                                                                 |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `npm run dev`                                                         | Create one development build with source maps.                          |
| `npm run watch`                                                       | Rebuild while source and copied resources change.                       |
| `npm run hot`                                                         | Start Vite's local proxy to the running Foundry server.                 |
| `npm run stage`                                                       | Create a staging build.                                                 |
| `npm run build`                                                       | Create the production distribution.                                     |
| `npm run clean`                                                       | Clean managed build output while protecting live compendium data.       |
| `npm run link`                                                        | Link the built module into the configured Foundry Data directory.       |
| `npm run foundry -- --version 14`                                     | Launch a configured Foundry installation.                               |
| `npm run pack`                                                        | Build declared compendiums from source data.                            |
| `npm run unpack`                                                      | Extract declared compendiums back into editable source data.            |
| `npm run rename-module -- --help`                                     | Show the identity-change options.                                       |
| `npm run lint`                                                        | Check JavaScript and JSON/source conventions.                           |
| `npm run format:check`                                                | Check formatting without changing files.                                |
| `npm run format`                                                      | Format project text files.                                              |
| `npm test`                                                            | Run behavioral tests with Node's built-in test runner.                  |
| `npm run verify:package`                                              | Validate a built module and its manifest paths.                         |
| `npm run check`                                                       | Run lint, formatting, tests, build, and package verification.           |
| `npm run release:prepare -- --repository your-account/example-module` | Prepare release assets using the source version.                        |
| `npm run upstream:check`                                              | Manually compare approved upstream files against the recorded baseline. |

In hot mode, CSS can update without a page reload. JavaScript and other module resources use a full reload so lifecycle hooks and wrappers are not registered twice. Ordinary watch mode updates the output on disk; reload Foundry to load the rebuilt JavaScript.

### Formatting

The Prettier configuration follows [Pin Cushion's formatting conventions](https://github.com/p4535992/foundryvtt-pin-cushion/blob/master/.prettierrc.json): a 120-character print width, four-space default indentation, and two spaces for JavaScript, JSON, and YAML. The stylesheet, HTML, and Handlebars parser overrides are retained, with `.yaml`, `.mjs`, and `.cjs` added to the corresponding file patterns.

EditorConfig uses the same indentation rules. Generated output, the npm lockfile, local configuration, and the attributed libWrapper fallback are excluded from formatting. Markdown documentation, including the changelog, is checked. Run `npm run format` before `npm run check` when you change project files.

### Changelog

Maintain [CHANGELOG.md](CHANGELOG.md) for module users. Record meaningful changes under `Unreleased`, grouped into `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, or `Security` as needed. Explain the user-visible result and include migration instructions when a change requires action.

Before releasing, set the same unprefixed semantic version in `src/module.json`, `package.json`, and `MODULE_VERSION` in `src/scripts/constants.js`, then move the applicable entries into a dated heading such as `## [1.2.3] - 2026-11-19`, leaving `Unreleased` available for future work. Keep the newest version first. The release tag and changelog version must match those source versions exactly. A prerelease such as `1.2.3-beta.1` needs its own entry and must appear in all three version fields.

Release preparation reads the entry for the exact source version and refuses to publish changelog content from `Unreleased` or another version. The workflow includes that entry and the generated installation instructions in the release description while preserving maintainer text outside its managed sections. The packaged module also includes the changelog.

## Distribution and release assets

A build produces the complete module beneath its ID:

```text
dist/
  <module-id>/
    module.json
    module.js
    styles/
      module.css
    lang/
    templates/
    assets/
    wiki/
    LICENSE
    THIRD_PARTY_NOTICES.md
    README.md
    CHANGELOG.md
```

Optional dependency chunks and declared compendium data are included when used. Source code, local configuration, build tools, and development dependencies are not part of the installable package.

The release preparation command builds in a separate staging directory and emits:

```text
artifacts/
  module.json
  module.zip
```

The ZIP retains the module directory:

```text
<module-id>/
  module.json
  module.js
  styles/
  lang/
  templates/
  assets/
  ...
```

The attached `module.json` and the manifest inside the ZIP must be byte-identical.

### Versioned downloads and the update feed

For a release tagged `1.2.3`, the generated manifest uses:

```json
{
    "version": "1.2.3",
    "manifest": "https://github.com/OWNER/REPOSITORY/releases/latest/download/module.json",
    "download": "https://github.com/OWNER/REPOSITORY/releases/download/1.2.3/module.zip"
}
```

`download` identifies the archive for that exact release. Stable releases use the latest stable manifest as their update feed. Prereleases point to the manifest attached to their own tag; choosing another prerelease or the stable channel is an explicit installation decision.

The publication workflows read the version automatically from `src/module.json` and require exact consistency with `package.json.version` and the literal `MODULE_VERSION`. Tags use that same unprefixed semantic version, such as `14.0.0` or `14.0.1-rc.1`. A leading `v` is rejected rather than removed.

### Create a release or prerelease

Prepare all three version fields and the matching dated changelog entry in the revision you intend to publish. In GitHub Actions, choose **Create Release** when the source version is stable, such as `14.0.0`, or **Create Prerelease** when it has a suffix, such as `14.0.1-rc.1`. Select the source branch or tag and run the workflow. There is no version input; the selected workflow validates that the source version belongs to its channel.

The workflow checks and packages the exact selected commit before creating its tag. It then creates a draft release, uploads and verifies both assets, and publishes the completed release. No tag or release needs to exist before the first run. Existing tags must already point to the same commit; published releases cannot be replaced. A failed upload leaves a draft that can be resumed from the same source revision.

Stable publication must advance the latest stable version. Prereleases are explicitly marked on GitHub and do not replace the stable update feed.

### Install a published release

To install a particular release, copy the URL of the **module.json asset attached to that release** and paste it into Foundry VTT's **Install Module → Manifest URL** field. That manifest downloads the ZIP attached to the same release.

To install the latest version, open the latest published release and use the `module.json` attached there.

For manual installation, download `module.zip` and extract it into `Data/modules/`. The archive already contains the correctly named module folder.

See [releasing](wiki/releasing.md) for the workflows, immutable source selection, tag creation, validation gates, release notes, and draft recovery.

## Stay aligned with DFreds

The upstream project remains a feature reference, while this repository preserves its JavaScript source, `src/` layout, optional integrations, and release format.

Run `npm run upstream:check` when you want to review upstream changes. The command compares a fixed list of source files with their recorded hashes. It reports differences without applying them. Review the behavior, adapt the relevant change, run the project checks, and update the baseline deliberately.

The mapping in [wiki/upstream.md](wiki/upstream.md) distinguishes preserved features, adaptations, and local additions. Dependency updates follow the same process: review the package change, update the lockfile, and verify the build and runtime behavior.

## Verification

Run `npm run check` before a release. The behavioral tests cover initialization, optional wrapping, safe local tooling, release manifests, archive layout, and packaging failures.

Build-time checks do not replace a Foundry runtime check. Test the module in a clean v14 world, open and close the settings window repeatedly, exercise its settings, check localization and console errors, and verify the installed ZIP rather than only the source tree. Add multiplayer and permission tests when a feature starts modifying shared documents.

## Attribution

This project adapts code and development conventions from **DFreds Module Template TS**, copyright 2025 Derek Fredrickson, under the MIT License. The optional libWrapper fallback retains the original attribution to Rui Pinheiro. Package metadata uses `license: "SEE LICENSE IN LICENSE"`; the actual license and notices remain in [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

The requested release asset names and folder layout follow the author's established packaging requirements. They are implemented independently for this JavaScript template.

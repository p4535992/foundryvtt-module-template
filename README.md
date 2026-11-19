# Foundry VTT Module Template

[![Checks](https://github.com/p4535992/foundryvtt-module-template/actions/workflows/check.yml/badge.svg?branch=main)](https://github.com/p4535992/foundryvtt-module-template/actions/workflows/check.yml)
[![Release](https://github.com/p4535992/foundryvtt-module-template/actions/workflows/release.yml/badge.svg)](https://github.com/p4535992/foundryvtt-module-template/actions/workflows/release.yml)
[![JavaScript](https://img.shields.io/badge/source-JavaScript-f7df1e)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Foundry VTT](https://img.shields.io/badge/Foundry_VTT-v14_target-orange)](https://foundryvtt.com/api/v14/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

A reusable **JavaScript + Vite** foundation for Foundry Virtual Tabletop modules. It combines a small Foundry lifecycle, optional libWrapper integration, development tools, and reproducible release packaging.

The starting module and package version is **14.0.0**, targeting Foundry VTT 14. See [verification](wiki/verification.md) for the automated checks and the remaining Foundry runtime validation.

The project adapts useful features from [DFreds Module Template TS](https://github.com/DFreds/dfreds-module-template-ts) to JavaScript and a single `src/` tree. [Upstream tracking](wiki/upstream.md) records the source-to-local mapping and deliberate differences.

## What is included

- JavaScript ES modules with a Vite build and development proxy.
- One module identity, read from `src/module.json`.
- Explicit `init`, `setup`, and `ready` handlers, with a public readiness contract.
- Namespaced settings, localization, Handlebars helpers, and logging.
- A small ApplicationV2 example that connects the template, styles, settings, and API.
- Optional libWrapper support; a fresh module registers no wrappers.
- English source strings in `src/lang/en.json`.
- Development builds, watch mode, safe Foundry linking, a launcher, and optional compendium tools.
- A rename command that protects binary assets and changes structured metadata.
- Release assets named `module.json` and `module.zip`, with version-specific download URLs.
- An archive containing the correctly named module directory.
- English release installation instructions with links generated for the exact release.
- A human-written changelog, with the matching version entry included in release notes.
- Prettier conventions carried over from Pin Cushion, with formatting checks for source and documentation.
- Manual, file-based upstream comparison, with a recorded baseline and no automatic code replacement.

The template targets Foundry v14. Set `compatibility.verified` only after testing your derived module in the actual Foundry build you intend to support. The initial manifest deliberately records the minimum target without claiming a completed runtime verification.

## Requirements

- Node.js 24, at least 24.14.1. `.nvmrc` selects the Node 24 line.
- npm and the committed `package-lock.json` for reproducible installs.
- A separately installed, licensed Foundry VTT v14 for runtime development and smoke testing.

Foundry runs the generated JavaScript. Node, Vite, Sass, and linting tools are development dependencies.

## Create your module

Create your own repository from this project and clone it outside Foundry's data directory.

```sh
nvm use
npm ci
npm run rename-module -- --id example-module --title "Example Module" --description "An example Foundry VTT module." --repository your-account/example-module
```

The command updates the module identity, package and lockfile metadata, namespaced strings, and repository links. Review the result and your author details before publishing, then commit the updated lockfile with the source changes.

Copy `foundryconfig.example.json` to `foundryconfig.json` and set your local paths. The local file is ignored by Git. Its `dataPath` must point to Foundry's **Data directory**, the directory containing `modules`, `systems`, and `worlds`.

```sh
npm run dev
npm run link
```

The link command connects `dist/<module-id>/` to `Data/modules/<module-id>/`. It reuses an identical existing link and refuses to replace a real directory. Enable the module in a test world and reload Foundry.

Open the example application from the browser console:

```js
await game.modules.get("example-module").api.open();
```

See [development tools](wiki/development.md) for local configuration, watch behavior, compendiums, and the launcher.

## Source structure

```text
src/
  module.json                 Package metadata and module identity
  module.js                   Styles and lifecycle entry point
  lang/
    en.json                   Namespaced English source strings
  styles/
    module.scss               Source styles, compiled to styles/module.css
  templates/
    demo.hbs                  Example ApplicationV2 template
  assets/
    module-icon.svg           Original, reusable module artwork
  scripts/
    constants.js              Identity and translation key helpers
    api.js                    Public readiness and application API
    settings.js               Settings registration and access
    logger.js                 Module-scoped logging and errors
    handlebars.js             Namespaced template helpers
    wrappers.js               Optional libWrapper integration
    hooks/
      index.js                Explicit lifecycle registration
      init.js                 Registration and API exposure
      setup.js                Integration setup
      ready.js                World-ready initialization
    applications/
      module-demo.js          ApplicationV2 example
    lib/
      libwrapper-shim.js      Attributed optional fallback

build/                        Build and release package implementation
utils/                        Node-only developer utilities
tests/                        Built-in Node test runner suites
wiki/                         Configuration, development, runtime, release, and upstream guides
.github/workflows/            Checks and release packaging
.github/RELEASE_TEMPLATE.md    English release installation section
CHANGELOG.md                  Unreleased work and dated version history
foundryconfig.example.json    Portable local configuration example
upstream.json                 Reviewed upstream files and hashes
vite.config.js                JavaScript Vite configuration
```

`src/` contains the module's authored source and resources. `build/` and `utils/` run in Node and are not shipped to Foundry. Generated output and machine-specific configuration are ignored by Git.

### Where new functionality belongs

Keep lifecycle handlers short. They register or start components; the actual behavior belongs in the component that owns it.

Small shared services can live in `src/scripts/services/`. Larger features can group their service, hooks, and application under `src/scripts/features/<feature-name>/`. Add these directories when there is real code to put in them.

Keep system-specific assumptions and third-party integrations in dedicated files. Prefer public Foundry APIs and documented hooks. Pass dependencies explicitly when doing so makes the behavior easier to understand or test.

## Lifecycle and public API

`src/module.js` registers the lifecycle once. The initialization stage registers settings and helpers and exposes the public API through `game.modules.get(moduleId).api`.

Foundry does not wait for promises returned by hook callbacks. The module therefore exposes its own readiness contract. Callers should use `await api.whenReady` or call an operation such as `api.open()` that handles readiness for them.

The demo window is an integration example rather than an automatic startup window. Closing and reopening it should not register another set of lifecycle hooks.

See [runtime behavior](wiki/runtime.md) for API details, permissions, lifecycle rules, and Foundry smoke tests.

### Optional libWrapper integration

The integration is available for features that need to wrap a method. The starter itself does not wrap Foundry methods or require the lib-wrapper module.

For an actual wrapping feature, prefer the real [libWrapper](https://github.com/ruipin/fvtt-lib-wrapper) module and document the dependency policy. The included fallback is deliberately limited and does not promise the full libWrapper API or conflict management. Preserve the wrapped function's return value and its `this` binding.

The fallback retains its original MIT attribution. [Third-party notices](THIRD_PARTY_NOTICES.md) describe the adapted sources and licensing.

## Development commands

| Command                                                                            | Purpose                                                                 |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `npm run dev`                                                                      | Create one development build with source maps.                          |
| `npm run watch`                                                                    | Rebuild while source and copied resources change.                       |
| `npm run hot`                                                                      | Start Vite's local proxy to the running Foundry server.                 |
| `npm run stage`                                                                    | Create a staging build.                                                 |
| `npm run build`                                                                    | Create the production distribution.                                     |
| `npm run clean`                                                                    | Clean managed build output while protecting live compendium data.       |
| `npm run link`                                                                     | Link the built module into the configured Foundry Data directory.       |
| `npm run foundry -- --version 14`                                                  | Launch a configured Foundry installation.                               |
| `npm run pack`                                                                     | Build declared compendiums from source data.                            |
| `npm run unpack`                                                                   | Extract declared compendiums back into editable source data.            |
| `npm run rename-module -- --help`                                                  | Show the identity-change options.                                       |
| `npm run lint`                                                                     | Check JavaScript and JSON/source conventions.                           |
| `npm run format:check`                                                             | Check formatting without changing files.                                |
| `npm run format`                                                                   | Format project text files.                                              |
| `npm test`                                                                         | Run behavioral tests with Node's built-in test runner.                  |
| `npm run verify:package`                                                           | Validate a built module and its manifest paths.                         |
| `npm run check`                                                                    | Run lint, formatting, tests, build, and package verification.           |
| `npm run release:prepare -- --tag v1.2.3 --repository your-account/example-module` | Prepare release assets for an exact tag.                                |
| `npm run upstream:check`                                                           | Manually compare approved upstream files against the recorded baseline. |

In hot mode, CSS can update without a page reload. JavaScript and other module resources use a full reload so lifecycle hooks and wrappers are not registered twice. Ordinary watch mode updates the output on disk; reload Foundry to load the rebuilt JavaScript.

### Formatting

The Prettier configuration follows [Pin Cushion's formatting conventions](https://github.com/p4535992/foundryvtt-pin-cushion/blob/master/.prettierrc.json): a 120-character print width, four-space default indentation, and two spaces for JavaScript, JSON, and YAML. The stylesheet, HTML, and Handlebars parser overrides are retained, with `.yaml`, `.mjs`, and `.cjs` added to the corresponding file patterns.

EditorConfig uses the same indentation rules. Generated output, the npm lockfile, local configuration, and the attributed libWrapper fallback are excluded from formatting. Markdown documentation, including the changelog, is checked. Run `npm run format` before `npm run check` when you change project files.

### Changelog

Maintain [CHANGELOG.md](CHANGELOG.md) for module users. Record meaningful changes under `Unreleased`, grouped into `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, or `Security` as needed. Explain the user-visible result and include migration instructions when a change requires action.

Before tagging a release, move the applicable entries into a dated heading such as `## [1.2.3] - 2026-11-19`, leaving `Unreleased` available for future work. Keep the newest version first. Use semantic versions consistently; the tag may add a leading `v`, but the changelog heading must not. A prerelease such as `1.2.3-beta.1` needs its own entry.

Release preparation reads the entry for the exact requested version and refuses to publish changelog content from `Unreleased` or another version. The workflow includes that entry and the generated installation instructions in the release description while preserving maintainer text outside its managed sections. The packaged module also includes the changelog.

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

For a release tagged `v1.2.3`, the generated manifest uses:

```json
{
    "version": "1.2.3",
    "manifest": "https://github.com/OWNER/REPOSITORY/releases/latest/download/module.json",
    "download": "https://github.com/OWNER/REPOSITORY/releases/download/v1.2.3/module.zip"
}
```

`download` identifies the archive for that exact release. `manifest` is the stable update feed. The complete tag, including an optional `v`, stays in asset URLs; the module version omits that prefix.

### Install a published release

To install a particular release, copy the URL of the **module.json asset attached to that release** and paste it into Foundry VTT's **Install Module → Manifest URL** field. That manifest downloads the ZIP attached to the same release.

To install the latest version, open the latest published release and use the `module.json` attached there.

For manual installation, download `module.zip` and extract it into `Data/modules/`. The archive already contains the correctly named module folder.

See [releasing](wiki/releasing.md) for the GitHub workflow, exact-tag checkout, validation gates, release notes, and prereleases.

## Stay aligned with DFreds

The upstream project remains a feature reference, while this repository preserves its JavaScript source, `src/` layout, optional integrations, and release format.

Run `npm run upstream:check` when you want to review upstream changes. The command compares a fixed list of source files with their recorded hashes. It reports differences without applying them. Review the behavior, adapt the relevant change, run the project checks, and update the baseline deliberately.

The mapping in [wiki/upstream.md](wiki/upstream.md) distinguishes preserved features, adaptations, and local additions. Dependency updates follow the same process: review the package change, update the lockfile, and verify the build and runtime behavior.

## Verification

Run `npm run check` before a release. The behavioral tests cover initialization, optional wrapping, safe local tooling, release manifests, archive layout, and packaging failures.

Build-time checks do not replace a Foundry runtime check. Test the module in a clean v14 world, open and close the example window repeatedly, exercise its settings, check localization and console errors, and verify the installed ZIP rather than only the source tree. Add multiplayer and permission tests when a feature starts modifying shared documents.

## Attribution

This project adapts code and development conventions from **DFreds Module Template TS**, copyright 2025 Derek Fredrickson, under the MIT License. The optional libWrapper fallback retains the original attribution to Rui Pinheiro. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

The requested release asset names and folder layout follow the author's established packaging requirements. They are implemented independently for this JavaScript template.

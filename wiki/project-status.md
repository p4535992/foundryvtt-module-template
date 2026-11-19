# Initial project checkpoint

This file records the remaining initialization work for the source checkpoint prepared on 19 November 2026. Remove this temporary status page and its README link after completing these steps.

## Prepared

- JavaScript ES modules, Vite configuration, and the agreed src/ layout.
- Module and package version 14.0.0, with Foundry compatibility minimum 14. The release has not been published.
- English documentation in wiki/, original developer commands in utils/, and build/release machinery in build/.
- Pin Cushion formatting conventions and modern lint, editor, and Git configuration.
- Curated CHANGELOG.md, exact-tag release manifests, module.zip packaging, and English installation instructions.
- Optional libWrapper integration and explicit init, setup, and ready handlers.
- Manual comparison against 26 reviewed DFreds source files.

## Verified without installed dependencies

- 42 behavioral tests passed with the built-in Node test runner.
- Seven JSON files and the JavaScript source contract validated.
- All 26 upstream baseline records validated offline.
- Workflow YAML syntax and generated fixture archives were checked.

These checks do not establish that a production Vite build or a Foundry runtime session has succeeded.

## Remaining initialization

1. Resolve and install the development dependencies with npm. The initial checkpoint does not include package-lock.json; the first install must generate it. Subsequent installations and CI use npm ci.
2. Review the resolved versions, commit the lockfile, run npm run format, and run npm run check. Fix any actual lint, formatting, build, or distribution failures.
3. Exercise the installed module and hot-development proxy in a licensed Foundry VTT 14 environment. Set compatibility.verified only after testing a specific Foundry build.
4. Before publishing v14.0.0, move the applicable Unreleased changelog entries into a dated [14.0.0] section and run the release preparation and artifact checks described in releasing.md.

The initial checkpoint commit uses [skip ci] because dependency installation and the lockfile are still pending. The committed workflows remain available for subsequent validated development and explicit releases.

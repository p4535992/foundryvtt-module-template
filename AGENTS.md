# Project conventions

## Architecture

- Keep runtime sources in JavaScript ES modules. Do not introduce TypeScript source, a TypeScript build step, or type-only runtime imports.
- Preserve `src/module.json`, `src/module.js`, and the `lang`, `styles`, `templates`, `assets`, and `scripts` directories beneath `src`.
- Read the module identity from `src/module.json` rather than duplicating it in build or runtime code.
- Keep lifecycle handlers small and make asynchronous readiness explicit.
- Keep libWrapper optional. Do not enable demonstration patches in a fresh starter.
- Use English for documentation, comments, workflow labels, and source translations.
- Keep versioned documentation in `wiki/` and developer commands in `utils/`. Keep Vite build and release machinery in `build/`.
- Keep package and source-manifest versions synchronized; the initial project version is `14.0.0`.

## Build and release

- Read the release version automatically from `src/module.json`; manual workflows must not ask for a version. Require exact equality with `package.json.version` and a dated changelog entry for that version.
- Use strict, unprefixed semantic versions for source metadata and release tags, such as `14.0.0` or `14.0.1-rc.1`. Reject a leading `v`; the stable and prerelease workflows must enforce their respective suffix rules.
- Produce the installable module under `dist/<module-id>/`.
- Release preparation must use a separate clean staging directory and protect live development compendium data.
- Publish assets named `module.json` and `module.zip`.
- Preserve `<module-id>/` as the ZIP's top-level directory.
- Point `download` at the exact release tag; preserve the stable manifest update feed.
- Pin prerelease manifests to their own tags. Never promote prereleases to the stable update feed.
- Publication must validate the selected commit, create its associated tag without moving an existing tag, verify both uploaded assets, and publish the draft last. Published releases are immutable.
- The manifest inside the archive and the separately attached manifest must be byte-identical.
- Generate the English installation section from `.github/RELEASE_TEMPLATE.md`.
- Maintain human-written, English changelog entries in `CHANGELOG.md`. Keep unreleased work under `Unreleased`; release preparation must use the dated entry matching the source version.
- Preserve upstream license and attribution notices in the repository and distribution.

## Maintenance

- Use the upstream mapping and recorded file hashes to review DFreds changes deliberately.
- Preserve local architectural decisions when adapting upstream behavior.
- Keep dependencies locked and workflow actions pinned to reviewed revisions.
- Use the repository Prettier configuration and keep EditorConfig consistent with its indentation rules.
- Run meaningful behavioral tests and package validation after changes to build or release logic.
- Record actual Foundry runtime verification separately from successful source checks.

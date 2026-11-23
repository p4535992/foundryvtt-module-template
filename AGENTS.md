# Project conventions

## Architecture

- Keep runtime sources in JavaScript ES modules. Do not introduce TypeScript source, a TypeScript build step, or type-only runtime imports.
- Preserve `src/module.json`, `src/module.js`, and the `lang`, `styles`, `templates`, `assets`, and `scripts` directories beneath `src`.
- Keep authored identity changes confined to `src/module.json`, `package.json`, and `src/scripts/constants.js`. Use literal exported MODULE_ID, MODULE_TITLE, and MODULE_VERSION values; validate their equality with the JSON metadata and derive paths and keys from them.
- Author translations under the `__MODULE_ID__` root and transform it structurally in build, watch, and hot mode. Inject Sass `$module-id`; do not rewrite language values, styles, or arbitrary source during a rename.
- Keep application classes and template filenames generic. Use ModuleSettingsApplication and the real client debug setting; do not add a placeholder feature toggle or global Handlebars helper.
- Keep lifecycle handlers small and make asynchronous readiness explicit.
- Keep libWrapper optional. Do not enable demonstration patches in a fresh starter.
- Use English for documentation, comments, workflow labels, and source translations.
- Keep versioned documentation in `wiki/` and developer commands in `utils/`. Keep Vite build and release machinery in `build/`.
- Keep package, source-manifest, and literal constant versions synchronized; the initial project version is `14.0.0`.
- Preserve the ModuleApi readiness contract and public paths `game.modules.get(MODULE_ID).api` and, after readiness, `game.modules.get(MODULE_ID).socket`. The canonical service is `.api.socket`.
- Guard the runtime socket alias and preserve the boolean core manifest flag in source and serialization. Never overwrite an unknown accessor; record a real Foundry smoke test before claiming compatibility.
- Use the original ModuleSocket over native Foundry 14 queries, with no socketlib dependency or fallback. Registered actions default to GM caller authorization; broader access must be explicit. Use core caller context, QUERY_USER permission checks, JSON payloads/results, and unchanged per-user settled results. Do not infer cancellation from timeouts or automatically retry mutations.
- Keep socketlib-style instance compatibility opt-in through the cached `.compat` SocketlibProxy. Preserve native payload/options signatures. Proxy calls use variadic data, return results for `executeAsGM`/`executeAsUser`, and initiate `executeFor*` broadcasts without awaiting recipients; report later failures through `onError`. Keep default GM authorization, strict true policies, canonical frozen sender context, and ownership-guarded cleanup. Reserve native `compat-` and `compat_` action prefixes for the adapter. Do not introduce socketlib globals, readiness events, factories, protocol emulation, or promises of complete socketlib compatibility.

## Build and release

- Keep `src/module.json`, `package.json`, and the literal `MODULE_VERSION` synchronized for source builds. The manual release workflow requires an explicit semantic version and a dated changelog entry for that version. Stamp the requested version only into generated release artifacts.
- Use strict, unprefixed semantic versions for source metadata and release tags, such as `14.0.0` or `14.0.1-rc.1`. Reject a leading `v`; the stable and prerelease channels of the single release workflow must enforce their respective suffix rules.
- Produce the installable module under `dist/<module-id>/`.
- Release preparation must use a separate clean staging directory and protect live development compendium data.
- Publish assets named `module.json` and `module.zip`.
- Preserve `<module-id>/` as the ZIP's top-level directory.
- Point `download` at the exact release tag; preserve the stable manifest update feed.
- Pin prerelease manifests to their own tags. Never promote prereleases to the stable update feed.
- Publication must validate the selected commit, create its associated tag without moving an existing tag, verify both uploaded assets, and publish the draft last. Published releases are immutable.
- The manifest inside the archive and the separately attached manifest must be byte-identical.
- Generate the English installation section from `.github/RELEASE_TEMPLATE.md`.
- Maintain human-written, English changelog entries in `CHANGELOG.md`. Keep unreleased work under `Unreleased`; release preparation must use the dated entry matching the explicitly requested release version.
- Preserve upstream license and attribution notices in the repository and distribution. Package metadata uses `main: "module.js"` and `license: "SEE LICENSE IN LICENSE"`; the actual license files remain authoritative.

## Maintenance

- Use the upstream mapping and recorded file hashes to review DFreds changes deliberately.
- Preserve local architectural decisions when adapting upstream behavior.
- Keep dependencies locked and workflow actions pinned to reviewed revisions.
- Use the repository Prettier configuration and keep EditorConfig consistent with its indentation rules.
- Run meaningful behavioral tests and package validation after changes to build or release logic.
- Record actual Foundry runtime verification separately from successful source checks.

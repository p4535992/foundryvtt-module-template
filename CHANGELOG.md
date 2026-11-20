# Changelog

Notable changes to this template are recorded here. Entries are curated by maintainers, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- An opt-in SocketlibProxy at the socket service's `.compat` path, providing documented socketlib-style instance methods over native Foundry 14 queries without a socketlib dependency.
- Variadic compatibility handlers, named or function-reference execution, result-returning calls with preserved undefined values, and broadcasts with separate background error reporting.
- Explicit compatibility-handler authorization, canonical caller context, guarded registration cleanup, and a migration guide covering API scope and multiplayer validation.

## [14.0.0] - 2026-11-19

### Added

- Separate stable-release and prerelease workflows with associated tag creation, verified draft uploads, and publication after validation.
- Guarded draft recovery and protection against changing existing tags, overwriting published releases, or moving the stable update feed backwards.
- JavaScript and Vite foundation with a unified src/ directory for the manifest, entry point, translations, styles, templates, assets, and scripts.
- Central lifecycle registration, client debug settings, logging, a ModuleApi class, and a reusable ModuleSettingsApplication.
- An original ModuleSocket service over native Foundry 14 queries, with explicit caller authorization, timeouts, and per-user settled results.
- Public API and active runtime socket paths with readiness coordination and guarded preservation of the core boolean socket manifest flag.
- Local Foundry configuration, linking, startup, module renaming, and compendium pack and unpack commands.
- Isolated release builds with an id-named directory inside module.zip and a byte-identical module.json attached separately.
- Version-specific ZIP download URLs, a latest stable manifest feed, and maintained English release instructions.
- Curated version-specific changelog sections in release descriptions, preserving unrelated author-written notes.
- Prettier configuration based on Pin Cushion, with consistent EditorConfig settings and formatting commands for source and documentation.
- Versioned project documentation in wiki/ and reusable developer commands in utils/.
- Optional selection of a declared compendium with the pack and unpack commands.
- Dependency-free archive verification and tests for package contents, manifest URLs, checksums, source leakage, and release descriptions.
- Explicit, read-only upstream comparison for the reviewed DFreds template files, with recorded provenance and preserved license notices.

### Changed

- Release workflows read the version from src/module.json automatically, require package.json, literal MODULE_VERSION, and the dated changelog to match, and use that exact unprefixed semantic version as the tag.
- Identity changes target three authored files and generated lockfile root metadata; translation namespaces and Sass scoping follow that identity through the build.
- Replaced the sample feature toggle and custom global Handlebars helper with a settings window for the real client debug setting.
- Declared module.js as the package entry and referenced the preserved license files through package metadata.
- Adapted the TypeScript-oriented upstream structure into JavaScript modules and Node.js helpers.
- Reimplemented the requested Pin Cushion package layout with an independent ZIP builder and release verifier.
- Migrated the legacy lint configuration into ESLint flat configuration, separating browser and Node environments and keeping runtime source linted.
- Set the initial module and package version to 14.0.0 and updated supported tooling pins using current official D&D 5e project references.

### Fixed

- Build startup now completes module evaluation before loading the Vite configuration.
- Manual publication validates and builds the selected commit instead of trying to check out a tag that does not yet exist.

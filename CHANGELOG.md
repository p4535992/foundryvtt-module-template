# Changelog

Notable changes to this template are recorded here. Entries are curated by maintainers, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [14.1.0] - 2026-11-20

### Added

- A reusable ModuleApi with explicit readiness, status, and a ModuleSettingsApplication for the real client debug setting.
- An original ModuleSocket service over native Foundry 14 queries, with named operations, explicit caller authorization, timeouts, and per-user settled results.
- Public API and active socket paths with readiness coordination and guarded preservation of the core boolean socket manifest flag.
- An opt-in SocketlibProxy at the socket service's .compat path, providing socketlib-style instance methods without requiring socketlib.
- Variadic compatibility handlers, named or function-reference execution, canonical caller context, preserved undefined results, and fire-and-forget broadcasts with background error reporting.
- A migration guide and focused behavioral tests for the native service, compatibility proxy, registration ownership, and copied-template identity.

### Changed

- Identity customization now targets src/module.json, package.json, and literal constants in src/scripts/constants.js, with generated root lockfile metadata kept in sync.
- Translation namespaces, stylesheet scoping, application paths, and query names derive from the module identity in production, watch, and hot modes.
- Stable and prerelease workflows read the source version automatically and require it to match package.json, MODULE_VERSION, and the dated changelog entry. New tags use unprefixed semantic versions.
- Package metadata declares module.js as the entry and SEE LICENSE IN LICENSE as the license reference.

### Removed

- The demonstration application, sample feature toggle, and unnecessary global Handlebars helper, replaced by reusable runtime components and the real debug setting.

### Fixed

- Query registration ownership and cleanup now inspect property descriptors without invoking or deleting a foreign accessor.
- Runtime socket attachment preserves serialized manifest data and rolls back if the field cannot safely expose the service.

## [14.0.0] - 2026-11-19

### Added

- Separate stable-release and prerelease workflows with associated tag creation, verified draft uploads, and publication after validation.
- Guarded draft recovery and protection against changing existing tags, overwriting published releases, or moving the stable update feed backwards.
- JavaScript and Vite foundation with a unified src/ directory for the manifest, entry point, translations, styles, templates, assets, and scripts.
- Central lifecycle registration, settings, logging, Handlebars helpers, a public API, and an ApplicationV2 demonstration.
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

- Adapted the TypeScript-oriented upstream structure into JavaScript modules and Node.js helpers.
- Reimplemented the requested Pin Cushion package layout with an independent ZIP builder and release verifier.
- Migrated the legacy lint configuration into ESLint flat configuration, separating browser and Node environments and keeping runtime source linted.
- Set the initial module and package version to 14.0.0 and updated supported tooling pins using current official D&D 5e project references.

### Fixed

- Build startup now completes module evaluation before loading the Vite configuration.
- Manual publication validates and builds the selected commit instead of trying to check out a tag that does not yet exist.

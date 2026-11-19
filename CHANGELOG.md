# Changelog

Notable changes to this template are recorded here. Entries are curated by maintainers, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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

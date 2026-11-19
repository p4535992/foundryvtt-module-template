# Verification

## Version 14.0.0

The first release was prepared with Node.js 24.22.3 and npm 11.9.0. Development dependencies are pinned in package.json and resolved in the committed package-lock.json. Use npm ci for subsequent installations.

The release checks include:

- ESLint for JavaScript and a source-contract check for JSON, the three identity files, literal constants, version equality, and the placeholder translation layout.
- Prettier formatting checks using the repository's configuration.
- Behavioral tests with the built-in Node test runner for API readiness, native query registration, caller authorization, per-user results, guarded socket alias serialization, and targeted identity changes.
- Release tests for tag creation, stable and prerelease policies, interrupted uploads, draft recovery, and publication guards.
- A production Vite build and distribution validation, including structural language namespaces, injected Sass identity, and reusable settings resources.
- An isolated release build, exact-tag manifest validation, ZIP layout and checksum checks, and byte-for-byte comparison of both manifest copies.

Publication reads src/module.json.version automatically and requires exact consistency with package.json.version, the literal MODULE_VERSION in src/scripts/constants.js, and the dated changelog entry. Versions and tags use strict, unprefixed SemVer. The stable workflow rejects a prerelease suffix; the prerelease workflow requires one. Neither manual workflow has a version input.

Run npm run check before preparing a release. The GitHub Check workflow uses the same command. The Create Release and Create Prerelease workflows repeat these checks, create the associated tag, and publish only after module.json and module.zip have been uploaded and verified.

## Foundry runtime validation

A licensed Foundry VTT instance is not part of this repository. The automated checks do not establish that the module has been exercised in an actual Foundry world, with multiple clients, or through a live Foundry development proxy. In particular, controlled test substitutes do not verify core query delivery/caller context, QUERY_USER enforcement in a live world, timeout behavior, or the module.socket property shape on an actual Foundry build.

The manifest targets Foundry generation 14 and leaves compatibility.verified unset. Set that field only after testing a specific Foundry build. Follow the [runtime smoke tests](runtime.md) and [development guide](development.md) when validating a derived module. Confirm the public API, the active socket alias, and that module.toObject(true).socket and module.toJSON().socket retain the manifest boolean after alias installation. Record both GM and player outcomes, including a rejected unauthorized query and a disconnected target.

## Maintaining the verification record

Keep release-specific test results separate from compatibility claims. Adding a dependency, integration, compendium, or permission-sensitive feature may require additional focused checks. Record the exact Foundry build and client roles used when completing runtime validation.

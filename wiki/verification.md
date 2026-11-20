# Verification

## Version 14.1.0

Version 14.1.0 adds the ModuleApi readiness and settings contract, explicit identity constants, native Foundry 14 queries, and the opt-in SocketlibProxy. The current automated suite contains 141 tests. Development dependencies are pinned in package.json and resolved in the committed package-lock.json; use npm ci for reproducible installations.

The validation gates for this release include:

- ESLint for JavaScript and a source-contract check for JSON, the three identity files, literal constants, version equality, and the placeholder translation layout.
- Prettier formatting checks using the repository's configuration.
- Behavioral tests with the built-in Node test runner for API readiness, native query registration, caller authorization, per-user results, guarded socket alias serialization, and targeted identity changes.
- Compatibility-proxy tests for instance-method signatures, handler registration and ownership, variadic arguments, return values, recipient selection, and background broadcast errors.
- Release tests for tag creation, stable and prerelease policies, interrupted uploads, draft recovery, and publication guards.
- A production Vite build and distribution validation, including structural language namespaces, injected Sass identity, and reusable settings resources.
- An isolated release build, exact-tag manifest validation, ZIP layout and checksum checks, and byte-for-byte comparison of both manifest copies.

Publication reads src/module.json.version automatically and requires exact consistency with package.json.version, the literal MODULE_VERSION in src/scripts/constants.js, and the dated changelog entry. Versions and tags use strict, unprefixed SemVer. The stable workflow rejects a prerelease suffix; the prerelease workflow requires one. Neither manual workflow has a version input.

Run npm run check before preparing a release. The GitHub Check workflow uses the same command. The Create Release and Create Prerelease workflows repeat these checks, create the associated tag, and publish only after module.json and module.zip have been uploaded and verified.

The `SocketlibProxy` tests exercise cached access and shared readiness, registration ownership, handler names and function-reference lookup, strict caller authorization, frozen sender context, variadic JSON arguments, and preservation of `undefined` results. They also cover current-GM selection, recipient filtering without input mutation, broadcasts that do not await handlers, background error reporting, and lifecycle cleanup.

These controlled tests validate the adapter contract without emulating all socketlib behavior or establishing real Foundry delivery. The native payload/options API and per-user result map remain separate from compatibility broadcasts. Use the [migration guide](socketlib-migration.md) when choosing the interface and interpreting its promises.

## Version 14.0.0: historical baseline

The initial release was published on 2026-11-19 under the legacy tag `v14.0.0`, from commit `f1b35fb1f6bf8e0fc3de3ef062766b5f71565558`. Its tag and published assets remain the historical record. The first release was prepared with Node.js 24.22.3 and npm 11.9.0.

The current API, identity, native-query, and compatibility-proxy checks above describe the 14.1.0 release scope; they do not retroactively verify those features in the original 14.0.0 artifact. Current publication uses unprefixed tags, beginning with `14.1.0`, and preserves the original prefixed tag.

## Foundry runtime validation

A licensed Foundry VTT instance is not part of this repository. The automated checks do not establish that the module has been exercised in an actual Foundry world, with multiple clients, or through a live Foundry development proxy. In particular, controlled test substitutes do not verify core query delivery/caller context, QUERY_USER enforcement in a live world, timeout behavior, or the module.socket property shape on an actual Foundry build.

The manifest targets Foundry generation 14 and leaves compatibility.verified unset. Set that field only after testing a specific Foundry build. Follow the [runtime smoke tests](runtime.md) and [development guide](development.md) when validating a derived module. Confirm the public API, the active socket alias, and that module.toObject(true).socket and module.toJSON().socket retain the manifest boolean after alias installation. Record both GM and player outcomes, including a rejected unauthorized query and a disconnected target. When using `.compat`, also complete its [runtime validation checklist](socketlib-migration.md#runtime-validation); no live Foundry result is claimed for the proxy.

## Maintaining the verification record

Keep release-specific test results separate from compatibility claims. Adding a dependency, integration, compendium, or permission-sensitive feature may require additional focused checks. Record the exact Foundry build and client roles used when completing runtime validation.

# Verification

## Version 14.0.0

The first release was prepared with Node.js 24.22.3 and npm 11.9.0. Development dependencies are pinned in package.json and resolved in the committed package-lock.json. Use npm ci for subsequent installations.

The release checks include:

- ESLint for JavaScript and a source-contract check for JSON, module identity, version consistency, and localization layout.
- Prettier formatting checks using the repository's configuration.
- 42 behavioral tests with the built-in Node test runner.
- A production Vite build and distribution validation.
- An isolated release build, exact-tag manifest validation, ZIP layout and checksum checks, and byte-for-byte comparison of both manifest copies.

Run npm run check before preparing a release. The GitHub Check workflow uses the same command. The Package Release workflow repeats these checks before attaching module.json and module.zip to the requested release.

## Foundry runtime validation

A licensed Foundry VTT instance is not part of this repository. The automated checks do not establish that the module has been exercised in an actual Foundry world, with multiple clients, or through a live Foundry development proxy.

The manifest targets Foundry generation 14 and leaves compatibility.verified unset. Set that field only after testing a specific Foundry build. Follow the [runtime smoke tests](runtime.md) and [development guide](development.md) when validating a derived module.

## Maintaining the verification record

Keep release-specific test results separate from compatibility claims. Adding a dependency, integration, compendium, or permission-sensitive feature may require additional focused checks. Record the exact Foundry build and client roles used when completing runtime validation.

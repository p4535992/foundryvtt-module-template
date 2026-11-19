# Developer utilities

This directory contains the original JavaScript utilities used to maintain the module project. The Vite build, release preparation, ZIP implementation, and package verification remain in build/.

Prefer the npm aliases so the command interface remains independent of file placement:

| File | Command | Purpose |
| --- | --- | --- |
| clean.js | `npm run clean` | Clean marked module output while preserving live compendiums |
| packs.js | `npm run pack` / `npm run unpack` | Compile or extract declared compendiums |
| link.js | `npm run link` | Link the built module to the configured Foundry Data directory |
| foundry.js | `npm run foundry -- --version 14` | Start the selected local Foundry installation |
| rename.js | `npm run rename-module -- --help` | Change the module identity and repository references |
| upstream.js | `npm run upstream:check` | Explicitly compare the reviewed upstream source files |
| check-source.js | `npm run lint:json` | Validate JSON, matching package/module versions, translations, and the source contract |

## Work with one compendium

Select a pack by its exact name in src/module.json:

```sh
npm run pack -- --pack example-items
npm run unpack -- --pack example-items
```

Without `--pack`, the command processes every declared pack. Unknown names fail before loading the compendium library. Existing output requires `--force`; close Foundry and preserve any edits before replacing it.

Pack sources live in packs-src/&lt;pack-name&gt;/ and compiled databases live in dist/&lt;module-id&gt;/packs/. The tools do not apply game-system-specific migrations, reset document ownership, or normalize authored item names.

## Shared implementation

Utilities import common configuration from build/config.js. The build imports the managed-output cleaner, and release preparation invokes the pack utility against an isolated staging directory.

There are no duplicate forwarding scripts under build/. The source patterns reviewed in Chat Portrait informed the useful clean/pack capabilities; their project-specific data transformations were not copied.

For detailed setup and behavior, see the [project documentation](../wiki/README.md). utils/ is not included in the built module or release ZIP.

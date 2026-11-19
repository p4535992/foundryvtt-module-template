# Developer utilities

This directory contains the original JavaScript utilities used to maintain the module project. The Vite build, release preparation, ZIP implementation, and package verification remain in build/.

Prefer the npm aliases so the command interface remains independent of file placement:

| File            | Command                           | Purpose                                                                                       |
| --------------- | --------------------------------- | --------------------------------------------------------------------------------------------- |
| clean.js        | `npm run clean`                   | Clean marked module output while preserving live compendiums                                  |
| packs.js        | `npm run pack` / `npm run unpack` | Compile or extract declared compendiums                                                       |
| link.js         | `npm run link`                    | Link the built module to the configured Foundry Data directory                                |
| foundry.js      | `npm run foundry -- --version 14` | Start the selected local Foundry installation                                                 |
| rename.js       | `npm run rename-module -- --help` | Update three identity files and generated lockfile root metadata                              |
| upstream.js     | `npm run upstream:check`          | Explicitly compare the reviewed upstream source files                                         |
| check-source.js | `npm run lint:json`               | Validate JSON, literal identity constants, three-way version equality, and translation source |

## Rename or version a module

```sh
npm run rename-module -- --id example-module --title "Example Module" --version 14.0.0 --repository your-account/example-module --dry-run
```

Remove `--dry-run` to apply the planned change. The authored targets are exactly `src/module.json`, `package.json`, and `src/scripts/constants.js`. The utility also refreshes generated root metadata in `package-lock.json`. Repository URLs change only when `--repository` is supplied.

Each of `MODULE_ID`, `MODULE_TITLE`, and `MODULE_VERSION` must have one exported string-literal declaration. Computed or missing declarations fail before writes. The tool updates structured metadata and those literal declarations; it does not rewrite language JSON, styles, assets, unrelated code, documentation, changelog history, or upstream provenance.

Build-time translation-root transformation and Sass injection carry the identity into generated resources. After a rename, rebuild and relink the module. Maintain the dated changelog entry separately before releasing a new version.

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

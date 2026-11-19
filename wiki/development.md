# Development

This template keeps the useful development workflow from DFreds' module template while using JavaScript for both runtime code and build tools. Foundry loads the generated ES module; Node runs the local tooling.

## Project layout

| Source                   | Purpose                                            | Built location                                    |
| ------------------------ | -------------------------------------------------- | ------------------------------------------------- |
| `src/module.json`        | Module identity, compatibility, and resource paths | `dist/<module-id>/module.json`                    |
| `src/module.js`          | Runtime entry point                                | `dist/<module-id>/module.js`                      |
| `src/scripts/`           | Hooks, settings, API, UI, and integrations         | Bundled into the entry or generated chunks        |
| `src/styles/module.scss` | Module styles                                      | `dist/<module-id>/styles/module.css`              |
| `src/lang/`              | Translation JSON                                   | `dist/<module-id>/lang/`                          |
| `src/templates/`         | Handlebars templates                               | `dist/<module-id>/templates/`                     |
| `src/assets/`            | Images and other static assets                     | `dist/<module-id>/assets/`                        |
| `packs-src/<pack-name>/` | Optional compendium source JSON                    | Compiled separately into the manifest's pack path |
| `build/`                 | Node command-line tools                            | Excluded from the module                          |
| `wiki/`                  | Development and runtime documentation              | `dist/<module-id>/wiki/`                          |

The build copies static resources explicitly. It does not expose the whole `src` directory as a public directory, and it does not copy JavaScript sources or pack source JSON into the distribution. README, CHANGELOG, and license notices are included.

Assets imported through JavaScript or styles are emitted under `scripts/generated-assets/`. This separate namespace keeps Vite-generated files safe when the static `assets/` directory is synchronized.

Keep runtime imports relative and use the `.js` extension. Read shared module identity from `src/scripts/constants.js`. The module id is defined in `src/module.json`.

## Local setup

Use Node 24 matching `.nvmrc`. Install the development dependencies using the package manager instructions in the README, then copy `foundryconfig.example.json` to `foundryconfig.json`.

Set `dataPath` to the **Data directory**, such as `/home/example/FoundryVTT/Data`, rather than the parent directory. The link command uses `Data/modules`; the launcher passes the parent to Foundry's `--dataPath` argument.

```json
{
    "dataPath": "/home/example/FoundryVTT/Data",
    "foundryUrl": "http://127.0.0.1:30000",
    "vitePort": 30001,
    "defaultVersion": "14",
    "versions": {
        "14": {
            "entry": "/home/example/foundryvtt-14/main.js",
            "args": []
        }
    }
}
```

`entry` must identify the actual Node entry point in your installation. The launcher uses the current Node executable by default. Add `executable` to select a different Node installation, or specify a desktop executable and omit `entry` to launch the desktop application. A version profile can provide its own `dataPath` to keep test worlds separate. The launcher passes arguments directly to the child process without a shell.

`foundryUrl` is the URL of the running Foundry server. It is used by the Vite proxy. `vitePort` is the local proxy port. These settings do not change Foundry's own listening port; configure Foundry or pass an appropriate argument in the version profile.

```sh
npm run dev
npm run link
npm run foundry -- --version 14
```

The first command builds the module. The second links `dist/<module-id>` into `Data/modules/<module-id>`. The third starts your configured Foundry installation. Enable the module in a development world.

On Windows, the link command creates a directory junction. Running it again with the same target is harmless. It refuses to replace a real directory or silently repoint an existing link.

## Rename a template copy

Use explicit options; there is no interactive prompt:

```sh
npm run rename-module -- --id my-module --title "My Module" --description "My Foundry module." --repository example/my-module --dry-run
npm run rename-module -- --id my-module --title "My Module" --description "My Foundry module." --repository example/my-module
```

The module id must begin with a lowercase letter and use lowercase letters, numbers, and hyphens. `--repository` accepts `owner/repository` or a GitHub HTTPS URL. If omitted, existing repository URLs are retained.

The command updates structured JSON and a defined set of text files, including module identity and repository references in `CHANGELOG.md`. Changelog version headings and dates are preserved. It updates translation namespaces, CSS prefixes, and JavaScript references to the old module id. It leaves `src/assets`, pack data, license notices, generated builds, and existing Foundry links untouched. Images are never processed as text. Review the changed files, rebuild, and link the new module id.

## Build modes

| Command         | Behavior                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------- |
| `npm run dev`   | One development build, source maps, readable JavaScript, and a development lock file        |
| `npm run watch` | Development build followed by JavaScript/style rebuilds and static-resource synchronization |
| `npm run hot`   | Local Vite proxy, CSS hot updates, and full-page reloads for runtime/static changes         |
| `npm run stage` | Compact local build with the development lock retained                                      |
| `npm run build` | Compact production build without the development lock                                       |
| `npm run clean` | Remove generated files for this module while preserving live compendium packs               |

`BUILD_MODE` is an explicit compile-time constant. Do not infer the configured build mode from `import.meta.env.DEV`: Vite's `--mode development` and `NODE_ENV` are separate settings.

### Watch mode

```sh
npm run watch
```

Vite rebuilds JavaScript and styles. A resource watcher also synchronizes new, changed, and deleted files in `src/lang`, `src/templates`, and `src/assets`, together with `src/module.json`. Reload Foundry after changes. This includes static-file updates that the upstream template's ordinary watch command does not copy automatically.

If you change the module id, stop the watcher, rebuild, and create the new link before restarting. A running watcher refuses to write a new identity into the old module directory.

### Hot mode

Build and link the module once, start Foundry, then run:

```sh
npm run hot
```

Open the Vite URL, normally `http://127.0.0.1:30001`, instead of the direct Foundry URL. Requests outside this module are proxied to Foundry, including its socket connection.

Styles update in place. Runtime JavaScript, manifest, translation, template, and asset changes reload the page. This intentionally uses a simpler lifecycle than DFreds' custom language/template hot events: full reloads recreate hooks and application state consistently. The dev proxy serves a virtual module entry and stylesheet response, so it does not create dummy files in the repository root.

### Output ownership and custom destinations

Builds use `dist/<module-id>`. An ownership marker beside that directory identifies it as generated by this checkout. Cleanup refuses an existing nonempty directory without a matching marker, and it refuses an output directory that is itself a symbolic link.

To build elsewhere:

```sh
npm run build -- --out-root .local-build
```

This produces `.local-build/<module-id>`. Existing sibling directories are not cleaned. Every normal build preserves `packs/` inside its managed module directory, including changes made in Foundry. Release preparation uses a separate staging directory so those editable packs are not accidentally packaged.

## Optional compendium packs

The starter has no required packs. For each pack, add a manifest definition using a unique name and a path such as `packs/example`. Store its editable source JSON under `packs-src/example`.

```sh
npm run pack
npm run unpack
```

`pack` uses the official Foundry CLI to compile source JSON into `dist/<module-id>/packs/example`. `unpack` extracts the built pack back into its source directory, keeping diffs clean when only volatile metadata changed. Declared packs with missing input directories fail with a useful error; they are not silently skipped.

Both commands refuse to replace existing output unless you pass `--force`. Close the Foundry world using the pack before either operation. Unpack changes made in Foundry before rebuilding a pack from source.

```sh
npm run unpack -- --force
npm run pack -- --force
```

These are separate operations for different directions of work; run the one that corresponds to the content you want to preserve. For a newly created pack, make its initial content in Foundry, close the world, and unpack it to create the source JSON.

Both commands accept `--out-root` to target a different module build. Pack sources remain outside `src` and are excluded from the installed module.

## Verification

```sh
npm test
npm run lint
npm run format:check
npm run build
npm run verify:package
```

The Node tests can run without installing the build dependencies. They exercise rename behavior with binary assets, cleanup ownership, symlink safety, resource watching, argument handling, and pack path/overwrite checks. Runtime tests verify module behavior using controlled Foundry substitutes. They do not replace a real Foundry smoke test.

After dependencies are installed, verify that both development and production builds contain every manifest resource. In Foundry 14, open the sample application, change its setting, reload, and repeat as a player. Check that repeated open/close cycles do not add duplicate listeners. For hot mode, test a CSS change and a JavaScript change separately. If adding packs, perform a real CLI pack/unpack round trip with stable document ids before releasing content.

Run `npm run release:prepare -- --version <version>` for isolated release preparation; see the README for release arguments and publishing instructions. Preparing files locally does not publish a release or notify an external service.

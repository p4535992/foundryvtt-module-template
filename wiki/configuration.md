# Project configuration

This template preserves the useful conventions from Pin Cushion while adapting
them to JavaScript, Vite, and ESLint 10. The official D&D 5e repository supplies a
second reference for modern Foundry development. Its project-specific formatting
rules and additional lint plugins are not dependencies of this starter.

## Configuration file map

| Original Pin Cushion file | Active file here | Adaptation |
| --- | --- | --- |
| [`.editorconfig`](https://github.com/p4535992/foundryvtt-pin-cushion/blob/master/.editorconfig) | `.editorconfig` | UTF-8, LF, spaces, final newline, and whitespace cleanup; indentation matches Prettier, with Markdown line-break spaces preserved |
| [`.eslintignore`](https://github.com/p4535992/foundryvtt-pin-cushion/blob/master/.eslintignore) | `eslint.config.js` | Global ignores cover generated files and the attributed shim; module source remains linted |
| [`.eslintrc.json`](https://github.com/p4535992/foundryvtt-pin-cushion/blob/master/.eslintrc.json) | `eslint.config.js` | Recommended JavaScript checks and selected semantic rules, with separate Foundry/browser and Node environments |
| [`.gitattributes`](https://github.com/p4535992/foundryvtt-pin-cushion/blob/master/.gitattributes) | `.gitattributes` | LF normalization and binary asset declarations; no exclusion of the README from source archives |
| [`.gitignore`](https://github.com/p4535992/foundryvtt-pin-cushion/blob/master/.gitignore) | `.gitignore` | Actual dependency/output/cache paths, local settings, and secrets; `package-lock.json` stays tracked |
| [`.prettierignore`](https://github.com/p4535992/foundryvtt-pin-cushion/blob/master/.prettierignore) | `.prettierignore` | Generated output, lockfile, local settings, and the attributed shim; maintained documentation remains formatable |
| [`.prettierrc.json`](https://github.com/p4535992/foundryvtt-pin-cushion/blob/master/.prettierrc.json) | `.prettierrc.json` | Pin Cushion formatting conventions, extended to `.mjs`, `.cjs`, and `.yaml` |

There are deliberately no inactive `.eslintrc.json` or `.eslintignore` files in
the project root. Their behavior is represented in the active flat configuration.
Change lint rules and ignore patterns in `eslint.config.js`; change formatting in
`.prettierrc.json`.

## Formatting conventions

| File type | Indentation | Formatter behavior |
| --- | --- | --- |
| General default | 4 spaces | Preferred print width 120; LF line endings |
| JavaScript, `.mjs`, `.cjs` | 2 spaces | Prettier's JavaScript formatter |
| JSON | 2 spaces | Prettier's JSON formatter |
| YAML, `.yml` and `.yaml` | 2 spaces | Prettier's YAML formatter |
| SCSS and CSS | 4 spaces | `scss` parser, with no required formatting pragma |
| HTML | 4 spaces | `html` parser with whitespace sensitivity set to `ignore` |
| Handlebars `.hbs` | 4 spaces | Pin Cushion's `angular` parser convention, with whitespace sensitivity set to `ignore` |

The Handlebars formatter choice does not add Angular to the module or change its
runtime template engine. Foundry still renders the templates with Handlebars.
Review the formatter's diff when introducing new Handlebars constructs; changing
the formatter parser is a separate decision from changing the UI framework.

`.editorconfig` matches these indentation rules rather than asking editors to use
two spaces everywhere while Prettier uses four for templates and styles. Markdown
trailing spaces are preserved because they can represent an intentional line break.

Run the separate checks when development dependencies are installed:

```sh
npm run lint
npm run format:check
```

Use `npm run format` to apply formatting and review the resulting diff. Formatting
is handled by Prettier, not duplicated across ESLint spacing, indentation, quote,
semicolon, and line-length rules.

## ESLint environment boundaries

| Scope | Available globals |
| --- | --- |
| `src/**/*.js` and `src/**/*.mjs` | Browser globals plus the small readonly Foundry list |
| `build/`, `utils/`, `tests/`, and root `*.config.*` files | Node globals |
| `.cjs` files | CommonJS source type; Node globals are scoped to tooling locations |

The readonly Foundry list is `Hooks`, `game`, `ui`, `foundry`, `CONFIG`, `CONST`,
`canvas`, and `Handlebars`. `BUILD_MODE` is a readonly compile-time value supplied
by the Vite configuration. Add other globals only when the module actually uses
them. Optional integrations can be accessed explicitly through `globalThis`.

Do not add Node globals to a shared configuration block that also matches runtime
source. Flat configuration merges globals, so a later browser block would not
remove `process`, `Buffer`, or `require`. The separate scopes help catch accidental
Node-only code before it reaches Foundry's browser.

The old Pin Cushion ignore file excluded `src/scripts/`; this starter deliberately
lints that directory. Only the narrowly identified third-party shim is excluded
from the regular lint/format pass. Its behavior is covered by the isolated runtime
tests, and changes still need review when synchronizing upstream code.

## Selected semantic rules

The baseline is `@eslint/js` recommended. Existing recommended errors are not
downgraded to warnings by repeating the older configuration's full rule list.

| Rule or group | Purpose |
| --- | --- |
| `array-callback-return` | Catch missing return values in transformations such as `map` |
| `eqeqeq` with a null exception | Require strict equality while allowing the intentional `value == null` check for both null and undefined |
| `no-duplicate-imports` | Keep imports and re-exports from the same module consistent |
| `no-eval`, `no-implied-eval`, `no-new-func` | Prevent accidental construction/execution of code from strings |
| `no-new-wrappers` | Avoid boxed primitive values |
| `no-throw-literal` | Prefer error objects over literal values |
| `no-var` | Use lexical declarations |
| `no-unused-vars` | Report unused code while allowing intentionally ignored names prefixed with `_` |
| `no-void` with statement use allowed | Permit deliberate detached operations such as `void promise.catch(...)` |
| `no-console: off` | Allow the module logger and command-line utilities to report useful information |

This JavaScript starter does not load TypeScript rules, Babel, JSDoc plugins,
stylistic plugins, or a Prettier ESLint plugin. JSDoc remains available for useful
API documentation without requiring comments on every private helper. Modern
JavaScript syntax uses the standard ESLint parser with `ecmaVersion: "latest"`.

The official D&D 5e repository's
[`eslint.config.mjs`](https://github.com/foundryvtt/dnd5e/blob/6.1.x/eslint.config.mjs)
supports the use of flat configuration and useful semantic rules such as
`no-duplicate-imports`, `no-var`, `no-implied-eval`, and `no-throw-literal`.
Its project-specific comma, arrow, spacing, JSDoc, and stylistic-plugin conventions
are intentionally separate from this template's Pin Cushion formatting preferences.

## Git and generated files

`package-lock.json` belongs in version control. It records the dependency graph
used by `npm ci`; it is ignored only by the formatter. Dependencies, generated
module output, release artifacts, temporary release staging, Vite caches, test
fixtures, and coverage output are not source files.

`foundryconfig.json` and environment files can contain personal paths or local
configuration. They are ignored; the example configuration is maintained in the
repository. Editor-local directories and ordinary operating-system files are also
ignored.

`.gitattributes` normalizes text to LF and treats binary media as binary. SVGs stay
text files. Release contents are controlled by the packaging machinery in
`build/`; developer commands live in `utils/`. The project does not use
`export-ignore` to remove its README or other
required package files. The
[official D&D 5e `.editorconfig`](https://github.com/foundryvtt/dnd5e/blob/6.1.x/.editorconfig)
also uses UTF-8, LF, spaces, final newlines, and whitespace cleanup; its
[`.gitignore`](https://github.com/foundryvtt/dnd5e/blob/6.1.x/.gitignore)
distinguishes maintained source from generated styles and compendium output.

Keep these decisions independent: Git decides what is maintained, the formatter
decides what it rewrites, ESLint checks executable JavaScript, and package
verification decides what is distributed to Foundry.

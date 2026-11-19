# Runtime architecture

This starter uses JavaScript ES modules. Foundry loads the generated `module.js`
declared by the manifest; Vite compiles the source stylesheet and bundles the
runtime. The package does not require TypeScript, Svelte, socketlib, or an installed
libWrapper module for the default demo.

## Source layout

| Path                                 | Responsibility                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| `src/module.json`                    | Source package manifest; the single source of the module ID, title, and version |
| `src/module.js`                      | Stylesheet import and one call to register lifecycle hooks                      |
| `src/scripts/constants.js`           | Manifest-derived IDs, asset paths, and localization keys                        |
| `src/scripts/hooks/`                 | Foundry `init`, `setup`, and `ready` handlers                                   |
| `src/scripts/api.js`                 | Public API, initialization outcome, and window-opening coordination             |
| `src/scripts/settings.js`            | Setting registration and access                                                 |
| `src/scripts/logger.js`              | Module-prefixed logging and user-facing error reporting                         |
| `src/scripts/handlebars.js`          | Namespaced Handlebars helper registration                                       |
| `src/scripts/applications/`          | Foundry application classes                                                     |
| `src/scripts/wrappers.js`            | Optional integration registrations; empty by default                            |
| `src/scripts/lib/libwrapper-shim.js` | Attributed, limited libWrapper fallback                                         |
| `src/lang/`                          | Localization JSON, starting with `en.json`                                      |
| `src/templates/`                     | Handlebars templates                                                            |
| `src/styles/`                        | Source styles, scoped to the module's application class                         |
| `src/assets/`                        | Static assets, including the original SVG demo icon                             |

Keep ordinary module logic under `src/scripts`. Introduce a dedicated service when
it has a clear responsibility and callers. Pass dependencies explicitly when that
makes a service easier to understand or test; this starter needs no service
container or event-bus abstraction.

## Initialization and public API

The entry point registers each lifecycle handler once. `init` and `setup` perform
synchronous registration. `ready` awaits template loading before marking the
module ready. Foundry's hook dispatcher does not wait for this module's async work,
so consumers must use the API's readiness promise when they depend on that work.

| Stage   | Work                                                                                           |
| ------- | ---------------------------------------------------------------------------------------------- |
| `init`  | Attach the API to the module, register client settings and the helper                          |
| `setup` | Read persisted settings to configure logging, then register any explicitly configured wrappers |
| `ready` | Load the demo template, resolve module readiness, emit the namespaced ready hook               |

After `init`, the API is available at:

```js
const api = game.modules.get("foundryvtt-module-template").api;

await api.whenReady;
await api.open();
```

`open()` also waits for readiness itself. The explicit `await api.whenReady` is
useful when another module needs to perform different work before opening the demo.
For an integration loaded before this module's `init`, look up the API from your
own `ready` handler or listen for the custom hook:

```js
Hooks.once("foundryvtt-module-template.ready", async (api) => {
    try {
        await api.open();
    } catch (error) {
        console.error("Could not open the module demo", error);
    }
});
```

| API member  | Contract                                                                                       |
| ----------- | ---------------------------------------------------------------------------------------------- |
| `id`        | Module ID from the source manifest                                                             |
| `version`   | Version from the installed package manifest, with the source version as a development fallback |
| `ready`     | `true` only after this module finishes initialization successfully                             |
| `status`    | `initializing`, `ready`, or `failed`                                                           |
| `error`     | Initialization error, or `null`                                                                |
| `whenReady` | Promise resolving to the API, or rejecting if initialization fails                             |
| `open()`    | Promise resolving to the rendered demo application                                             |

The API object is frozen; its getters reflect current state. Simultaneous `open()`
calls share the same in-flight operation and application instance. If rendering
fails, a later `open()` can retry. An initialization failure remains a failure for
that page session; reload after fixing its cause.

The installed manifest is authoritative for the runtime API's version. Release
packaging preserves the source version and generates only the release URLs in the
staged manifest.

Startup failures are logged and reported to the current user. The readiness
promise retains the rejection for consumers without producing an unhandled
rejection when no consumer exists. Do not mark the API ready before new asynchronous
startup work finishes. If you add async work to `init` or `setup`, explicitly join
that work into the `ready` sequence rather than assuming Foundry awaits hooks.

Register setting definitions in `init`, but read their stored values only from
`setup` onward. The logger is configured from its saved debug setting during
`setup`, when Foundry has initialized client and world settings storage.

## Settings, templates, and styles

The sample setting and debug logging setting use the `client` scope, so the demo
works for both GMs and players. A setting intended to control shared world behavior
should instead use the appropriate scope and permission checks for its use case.
Debug logging affects only this module; it does not set `CONFIG.debug.hooks`.

The helper `foundryvtt-module-template-uppercase` is namespaced to avoid registering
a generic `uppercase` helper shared by unrelated modules. Localization keys are
derived from the module ID in JavaScript. The English JSON root, helper reference
in the demo template, and SCSS selector also contain the module ID and must be
updated when renaming the starter.

The demo uses Foundry's `ApplicationV2` with `HandlebarsApplicationMixin`. It reads
the sample setting into template context and writes through the settings API from
a named action. Handlebars escapes ordinary interpolated values. The stylesheet is
scoped below `.foundryvtt-module-template`, and the decorative SVG has empty alt text
in the window because the adjacent heading already identifies the content.

## Optional libWrapper integration

The starter registers **no wrappers by default**. It does not patch application
focus, token dragging, audio, or any other Foundry behavior on startup.

Add a deliberate entry to the `definitions` array in `src/scripts/wrappers.js`
when a module feature needs wrapping. For example, the following illustrates a
wrapper that preserves its arguments, context, and return value:

```js
{
  target: "foundry.applications.api.ApplicationV2.prototype.bringToFront",
  type: "WRAPPER",
  wrapper: function (wrapped, ...args) {
    return wrapped(...args);
  },
}
```

That example is documentation, not an active registration. Prefer public hooks or
extension points when they can implement the feature. Use a regular function when
you need libWrapper's `this` binding, and return the wrapped result. Await it only
when the wrapped method is asynchronous and your additional work requires that.

The adapter selects the real `globalThis.libWrapper` when present. Otherwise, its
small fallback can wrap methods and getters/setters reachable through `globalThis`,
including quoted property paths. It supports the basic wrapper, listener, and
override modes. It does **not** implement the complete libWrapper API, conflict
handling, priorities, or unregistration. A module needing those features should
require the real library and use its documented API.

A warning is scheduled only after a fallback registration succeeds. It logs once
per page session and shows the GM a localized notification after Foundry is ready.
An unmodified starter does not warn about a missing optional dependency. Unlike the
upstream demonstration shim, this adaptation does not open a blocking fallback
dialog or evaluate target strings as code.

If a module actually uses wrapping, declare `lib-wrapper` as recommended or
required according to the behavior it needs. The base manifest intentionally has
an empty `relationships.requires` list. The fallback is not a reason to claim that
all libWrapper functionality is available without the library.

## Development reload behavior

Styles can use Vite's CSS hot replacement. JavaScript, translations, templates,
the manifest, and other assets use the development tooling's full-page reload
strategy. A clean Foundry initialization avoids duplicate hook/wrapper
registrations, stale translations, and partially refreshed application state.

There is no runtime `import.meta.hot.accept()` or custom `lang-update` /
`template-update` protocol. Those DFreds features were intentionally adapted to a
full reload rather than copied with assumptions about English-only updates or
rerendering every other module's window.

## Relationship to the DFreds template

The lifecycle organization, small entry point, manifest-derived module ID,
settings/logger/helper conventions, module API, and optional libWrapper fallback
are adapted from the MIT-licensed
[DFreds Module Template TS](https://github.com/DFreds/dfreds-module-template-ts/tree/main).
The source has been converted to JavaScript and reorganized for this repository's
`src` layout. Type-only declarations and imports do not become runtime files.

The explicit ready stage, readiness promise, concurrent-open handling, namespaced
helper, disabled demonstration patches, and lazy fallback warning are local
design choices. Preserve the upstream MIT notices and the Rui Pinheiro shim header
when distributing derived code. See the project license and upstream-sync notes
for attribution and the feature mapping.

## Runtime smoke test

These checks require a licensed Foundry installation and a disposable test world.
The source manifest omits `compatibility.verified` until someone records a
successful check on a specific Foundry build.

1. Install or link the built package, enable it, and reload the world. Confirm that
   initialization produces no errors and no libWrapper warning on the unchanged
   starter.
2. In the browser console, retrieve the module API, await `whenReady`, and check
   that `ready` is true and `status` is `ready`.
3. Run `await api.open()`. Confirm that the window displays the icon, English text,
   styling, current setting, and manifest version without missing-file requests.
4. Toggle the setting, close and reopen the window, and reload the world. Confirm
   that the value persists for that client. Repeat as a player as well as a GM.
5. Invoke `Promise.all([api.open(), api.open()])`. Confirm that only one application
   instance is used.
6. Enable debug logging and confirm that it prefixes this module's messages.
   Confirm that global hook debugging has not been enabled by this module.
7. During development, change a style and a template separately. Check the expected
   style update/page reload and confirm there are no duplicate handlers afterward.
8. If you add a wrapper, test the feature with real libWrapper installed, then test
   any supported fallback scenario explicitly. The unchanged starter has no
   wrapping behavior to test.

The isolated Node tests cover readiness/failure semantics, concurrent opening,
retry behavior, fallback method/accessor preservation, and real-library selection.
They do not claim to verify Foundry's browser API, rendering, multiplayer behavior,
or a particular Foundry version.

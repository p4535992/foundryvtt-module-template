# Runtime architecture

The runtime is JavaScript ES modules targeting Foundry VTT 14. Foundry loads the generated `module.js` declared by the manifest. Vite bundles the runtime, compiles Sass, and prepares static resources. The settings application and native query service are ordinary module features; neither needs socketlib or an installed libWrapper module.

## Source layout

| Path                                          | Responsibility                                                                                |
| --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `src/module.json`                             | Package identity, compatibility, resource paths, and source version                           |
| `src/module.js`                               | Stylesheet import and one call to register lifecycle hooks                                    |
| `src/scripts/constants.js`                    | Literal `MODULE_ID`, `MODULE_TITLE`, and `MODULE_VERSION`; derived paths and translation keys |
| `src/scripts/hooks/`                          | Foundry `init`, `setup`, and `ready` handlers                                                 |
| `src/scripts/api.js`                          | `ModuleApi`, readiness, status, and settings-window access                                    |
| `src/scripts/module-registry.js`              | API attachment and guarded runtime socket alias                                               |
| `src/scripts/socket.js`                       | `ModuleSocket`, backed by native Foundry queries                                              |
| `src/scripts/socket-handlers.js`              | Named remote actions and their authorization policies                                         |
| `src/scripts/settings.js`                     | Registration and access for the real client debug setting                                     |
| `src/scripts/logger.js`                       | Module diagnostics and user-facing error reporting                                            |
| `src/scripts/applications/module-settings.js` | `ModuleSettingsApplication`                                                                   |
| `src/scripts/wrappers.js`                     | Optional libWrapper registrations; empty by default                                           |
| `src/scripts/lib/libwrapper-shim.js`          | Attributed, limited libWrapper fallback                                                       |
| `src/lang/`                                   | Translation JSON authored under the `__MODULE_ID__` root                                      |
| `src/templates/module-settings.hbs`           | Settings application template                                                                 |
| `src/styles/module.scss`                      | Styles scoped using injected `$module-id`                                                     |
| `src/assets/`                                 | Static assets, including the reusable module icon                                             |

Keep feature logic in the component that owns it. Add focused service or feature directories as the module grows. The starter needs no service container or additional event bus.

## Identity and generated resources

Only `src/module.json`, `package.json`, and `src/scripts/constants.js` need manual identity edits. Keep the three versions identical, the package name equal to the module id and `MODULE_ID`, and the manifest title equal to `MODULE_TITLE`. Constants are explicit exported string literals; paths, query names, and localization keys derive from them.

The source language root is `__MODULE_ID__`. Build, watch, and hot mode transform that root structurally into the current module id. Sass receives `$module-id` from Vite, so `.#{$module-id}` scopes the generic `.module-settings` styles. Application class names and template filenames remain generic. See [configuration](configuration.md) for the identity contract.

Release packaging preserves the source version and generates release URLs. The API reports the installed package version, with `MODULE_VERSION` as a development fallback.

## Initialization and readiness

| Stage   | Work                                                                                                               |
| ------- | ------------------------------------------------------------------------------------------------------------------ |
| `init`  | Register the client debug setting, attach `ModuleApi`, and register named query handlers on every client           |
| `setup` | Read persisted settings, configure module logging, and register explicitly configured wrappers                     |
| `ready` | Preload the settings template, activate the socket service, expose its runtime alias, and resolve module readiness |

Foundry does not await promises returned by hook callbacks. The API therefore owns a `whenReady` promise. Add new asynchronous startup work to this sequence before marking the module ready.

The API is available after `init` at the public path:

```js
const api = game.modules.get(MODULE_ID).api;
await api.whenReady;
await api.openSettings();
```

Import `MODULE_ID` from the constants module when writing module source. In a browser console, substitute the literal id from your manifest. Integrations initialized before this module should look up the API from their `ready` hook or observe `MODULE_ID + ".ready"`.

| API member       | Contract                                                                      |
| ---------------- | ----------------------------------------------------------------------------- |
| `id`             | Module id                                                                     |
| `title`          | Module title                                                                  |
| `version`        | Installed package version, with the literal source constant as fallback       |
| `ready`          | Whether initialization completed successfully                                 |
| `status`         | `initializing`, `ready`, or `failed`                                          |
| `error`          | Preserved initialization error, or `null`                                     |
| `whenReady`      | Promise resolving to the API or rejecting with the initialization failure     |
| `open()`         | Wait for readiness and render the settings application                        |
| `openSettings()` | Alias for `open()`                                                            |
| `getStatus()`    | Read-only status snapshot                                                     |
| `socket`         | Canonical `ModuleSocket` service; present from init, inactive until readiness |

`getStatus()` returns `{ id, title, version, ready, status, socketActive, socketProvider }`. The provider is `"foundry"` while the service is active and `null` otherwise.

Concurrent opening calls share the same in-flight operation and application instance. Rendering failures permit a later opening attempt; initialization failures remain failures for that page session. Startup errors are reported, and the readiness promise retains the original rejection.

## Public socket access

Use **`game.modules.get(MODULE_ID).api.socket`** as the canonical service path. After readiness, while the service is active, the public convenience alias is **`game.modules.get(MODULE_ID).socket`**. Both refer to the same service instance.

```js
const module = game.modules.get(MODULE_ID);
const api = module.api;
await api.whenReady;

const socket = api.socket;
const runtimeAlias = game.modules.get(MODULE_ID).socket;
console.assert(runtimeAlias === socket && socket.active);

const gmStatus = await socket.executeAsGM("getStatus", {}, { timeout: 5000 });
console.log(gmStatus);
```

Foundry's `module.socket` field is also the core manifest flag. The source manifest keeps `"socket": true` as a boolean. The registry helper installs the runtime alias only when it finds an independent writable boolean property and confirms that `module.toObject(true).socket` and `module.toJSON().socket` remain boolean. It restores the original property if serialization changes and refuses unknown accessors.

This guard is a deliberate compatibility check, not evidence of completed Foundry runtime verification. Test the alias and manifest serialization on the actual supported build. The service uses native query APIs; enabling the raw module socket namespace in the manifest does not make raw messages part of this service.

## Native query contract

`ModuleSocket` is an original adapter over [CONFIG.queries](https://foundryvtt.com/api/v14/variables/CONFIG.queries.html), [User.query](https://foundryvtt.com/api/v14/classes/foundry.documents.User.html#query), and [User.queryMany](https://foundryvtt.com/api/v14/classes/foundry.documents.User.html#queryMany). It uses core request handling and timeouts.

Register each action on every client during `init`:

```js
moduleSocket.register(
    "readSummary",
    async (payload, { user }) => ({ requesterId: user.id, requested: payload.label }),
    {
        authorize: (user, payload) => user.active && typeof payload.label === "string",
    },
);
```

The service prefixes the action with `MODULE_ID + "."`. Action names start with a letter and contain only letters, digits, underscores, or hyphens. Duplicate or conflicting registrations are refused. Repeating the same registration is safe only when its handler, policy, and registry entry are unchanged.

The handler receives `(payload, { user })`. The authorization function receives `(user, payload)` and may be asynchronous; it must resolve to exactly `true`. Omitting it permits GM callers only. The base module registers only `getStatus`, with an explicit policy allowing active users to read its status.

The service resolves the caller from core's query context back to the canonical active User in `game.users`. A claimed user id inside the payload never replaces that caller. Feature handlers must still validate operation-specific fields, ownership, and permissions before making changes. The current caller also needs the core [QUERY_USER permission](https://foundryvtt.com/api/v14/variables/CONST.USER_PERMISSIONS.html).

Payloads must be JSON objects or arrays, without cycles or class instances. Return a JSON value from the handler; use `null` when there is no result. Document instances, functions, undefined values, and Error objects are not serializable service results.

| Method                                                         | Behavior                                                                          |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `executeAsUser(action, userId, payload = {}, options = {})`    | Query one active user and return its result                                       |
| `executeAsGM(action, payload = {}, options = {})`              | Query the one user selected by `game.users.activeGM`; fail when none is available |
| `executeForUsers(action, userIds, payload = {}, options = {})` | Query a unique set of active users; duplicate ids are queried once                |
| `executeForEveryone(action, payload = {}, options = {})`       | Query all active users, including the current user                                |
| `executeForOthers(action, payload = {}, options = {})`         | Query active users other than the current user                                    |

`options.timeout` is a positive finite duration in milliseconds; the service default is 10,000 ms. Self-targeted calls use the same native query path and authorization checks. Unknown or inactive targets fail explicitly.

Multi-user methods return core's `Map<User, PromiseSettledResult>` unchanged. Inspect each outcome:

```js
const results = await api.socket.executeForEveryone("getStatus");
for (const [user, outcome] of results) {
    if (outcome.status === "fulfilled") console.log(user.name, outcome.value);
    else console.warn(user.name, outcome.reason);
}
```

These calls collect settled outcomes; they do not promise socketlib's fire-and-forget broadcast semantics. Errors propagate through core's promises or individual settled results. There are no automatic retries or alternate transports. A timeout is not a safe signal to repeat a write: the remote action may already have run. Define an explicit idempotency policy before adding retries to a mutating feature.

Socketlib remains useful for projects with different compatibility or API requirements. Its [current README](https://github.com/farling42/foundryvtt-socketlib/blob/develop/README.md) recommends considering native queries on Foundry 14+, and its [official package](https://foundryvtt.com/packages/socketlib) declares Foundry 14 compatibility. This starter has no socketlib dependency, fallback, or copied socketlib implementation.

## Settings application, localization, and styles

`ModuleSettingsApplication` uses Foundry's [ApplicationV2](https://foundryvtt.com/api/v14/classes/foundry.applications.api.ApplicationV2.html) with `HandlebarsApplicationMixin`. It renders `templates/module-settings.hbs`, shows the module identity and current debug state, and changes the real debug setting through `game.settings`.

Debug uses client scope and defaults to false. A player changing it changes that client's diagnostics, not shared world behavior or global hook debugging. Setting definitions are registered during init; saved values are read from setup onward.

The application builds localization keys and resource paths from the constants module. It uses Foundry's built-in template helpers and registers no global Handlebars helper. Its generic `ModuleSettingsApplication` class, template filename, and `.module-settings` styles remain reusable after an identity change.

## Optional libWrapper integration

The starter registers no wrappers by default. Add an intentional definition in `src/scripts/wrappers.js` only when a feature needs it, and prefer public hooks or extension points when they fit.

The adapter selects `globalThis.libWrapper` when available. Its attributed fallback supports basic methods and getters/setters through explicit property paths, preserving the wrapped context and result. It does not promise complete libWrapper priorities, conflict handling, or unregistration. Features needing the full library should declare that dependency.

A successful fallback registration logs a warning once and schedules a localized GM notification after Foundry is ready. An unchanged starter has no fallback registration to warn about. Preserve the Rui Pinheiro attribution and the full notices in the distribution.

## Development and provenance

CSS can update through Vite hot replacement. Runtime JavaScript, templates, translations, manifest, and asset changes use full-page reloads so registration and readiness restart coherently. There is no custom runtime HMR protocol or automatic rerender of other modules.

The small entry point, lifecycle organization, settings/logger conventions, and limited libWrapper fallback are adapted from [DFreds Module Template TS](https://github.com/DFreds/dfreds-module-template-ts). Literal identity validation, structural translation generation, the settings application, `ModuleApi`, native `ModuleSocket`, authorization policies, and guarded runtime alias are local design choices. [upstream.json](../upstream.json) records the mapping without treating these additions as upstream code.

## Runtime smoke test

Use a licensed Foundry installation and a disposable world. Record the exact Foundry build and client roles in [verification](verification.md) before setting `compatibility.verified`.

1. Install the built ZIP or link the build, enable the module, and reload. Confirm clean initialization with a GM and player client.
2. Retrieve `game.modules.get(MODULE_ID).api`, await `whenReady`, and check its identity, ready status, and `getStatus()` snapshot.
3. Confirm that `game.modules.get(MODULE_ID).socket` is the active `api.socket` instance. Check that both `toObject(true).socket` and `toJSON().socket` still equal the manifest's boolean. Exercise Foundry's module management and serialization paths.
4. Open the settings window with both public opening methods. Toggle debug, close, reopen, and reload. Confirm persistence for that client, correct localization, and unchanged global hook debugging.
5. Call `Promise.all([api.open(), api.openSettings()])` and confirm a single application instance and no duplicate listeners.
6. Exercise `getStatus` against one user, the active GM, everyone, and others. Inspect each multi-user outcome. Check behavior with QUERY_USER allowed and denied, no active GM, a disconnected target, and a timeout.
7. For any new mutating action, verify that unauthorized callers are rejected before changes occur, including a payload containing a false caller id. Test its actual feature-specific ownership policy.
8. Rename a test copy through the three identity files, rebuild, and verify translated keys, style scoping, template paths, API identity, and query names. Test translation/style changes in watch and hot mode.
9. If a feature adds a wrapper, test real libWrapper and each supported fallback scenario explicitly.

Controlled Node tests do not establish real Foundry socket delivery, caller context, rendering, browser timeouts, multiplayer behavior, or runtime alias compatibility. Complete those checks on the installed package.

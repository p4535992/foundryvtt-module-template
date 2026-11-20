# Socketlib-style instance methods

`SocketlibProxy` is an opt-in adapter over this template's native Foundry 14 `ModuleSocket`. It supports the documented socketlib instance methods for registration, result-returning calls, and broadcasts. Its implementation is original; it imports no socketlib code and requires no socketlib module.

The native API remains the default. Use its payload/options methods when you need explicit per-call timeouts or a `Map<User, PromiseSettledResult>` from a multi-user query. Use `.compat` when migrating code that already calls a registered socket instance with variadic arguments.

## Access and readiness

The native service lazily creates and caches its compatibility proxy. Register handlers during the existing init sequence, then wait for module readiness before calling them:

```js
const api = game.modules.get(MODULE_ID).api;
await api.whenReady;

const socket = api.socket.compat;
console.assert(socket === game.modules.get(MODULE_ID).socket.compat);
const status = await socket.executeAsGM("getStatus");
```

Import `MODULE_ID` from the constants module in source code, or use your actual module id in the browser console. The built-in `getStatus` operation is registered on both native and compatibility interfaces and explicitly permits active callers. The proxy's `active` and `provider` getters reflect the native service; it does not have an independent readiness event or transport.

## Migrate registration

A typical socketlib registration uses its global factory and readiness hook:

```js
let socket;
Hooks.once("socketlib.ready", () => {
    socket = socketlib.registerModule(MODULE_ID);
    socket.register("readSummary", readSummary);
});
```

In this template, add the compatibility registration to `src/scripts/socket-handlers.js`. The existing `registerSocketHandlers` function is called on every client during init. Keep the starter's status registrations and add your handler and an explicit policy:

```js
import { moduleApi } from "./api.js";
import { moduleSocket } from "./socket.js";

function getStatus() {
    return moduleApi.getStatus();
}

function allowActiveUser(user) {
    return user.active === true;
}

function readSummary(label) {
    return { requesterId: this.socketdata.userId, label };
}

function allowReadSummary(user, label) {
    return user.active === true && typeof label === "string";
}

export function registerSocketHandlers() {
    moduleSocket.register("getStatus", getStatus, { authorize: allowActiveUser });
    moduleSocket.compat.register("getStatus", getStatus, { authorize: allowActiveUser });
    moduleSocket.compat.register("readSummary", readSummary, { authorize: allowReadSummary });
}
```

Call the registered instance after readiness:

```js
const api = game.modules.get(MODULE_ID).api;
await api.whenReady;
const summary = await api.socket.compat.executeAsGM("readSummary", "party");
```

Remove the old `socketlib.ready` registration and the actual socketlib manifest dependency in a derived module only after confirming that no other feature still uses the library. The template itself declares no such dependency. It provides no global `socketlib`, `registerModule` or `registerSystem` factory, socketlib event, protocol compatibility, or socketlib error classes. Other modules using real socketlib do not automatically share registrations with this proxy.

## Supported methods

In this table, `handler` is a registered name or the exact callback function registered on this client.

| Method                                         | Selection and return value                                                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `register(name, callback, { authorize } = {})` | Register this client's query handler; returns `undefined`                                                                 |
| `executeAsGM(handler, ...args)`                | Prefer the current active user when that user is a GM; otherwise query `game.users.activeGM`. Await and return the result |
| `executeAsUser(handler, userId, ...args)`      | Query one active user. Await and return the result                                                                        |
| `executeForAllGMs(handler, ...args)`           | Initiate queries to all active GMs                                                                                        |
| `executeForOtherGMs(handler, ...args)`         | Initiate queries to active GMs other than the current user                                                                |
| `executeForEveryone(handler, ...args)`         | Initiate queries to all active users, including the current user                                                          |
| `executeForOthers(handler, ...args)`           | Initiate queries to active users other than the current user                                                              |
| `executeForUsers(handler, userIds, ...args)`   | Copy and deduplicate the supplied array; initiate queries only to known active user ids                                   |

All five `executeFor*` methods return `Promise<undefined>` after initiating native fan-out. They do not await remote completion, even when the current user is a recipient. Awaiting that promise does not establish delivery, successful execution, or completion, and it yields no result map. Every self-target uses the same native query path and authorization checks as a remote target.

`executeAsUser` fails for an unknown or inactive target. `executeForUsers` requires an array and leaves it unchanged; unknown, inactive, and non-string entries are ignored. Other broadcast methods select active users. `executeAsGM` fails when no suitable GM is available.

## Names, arguments, and caller authorization

Handler names may be any nonempty string, including dots, spaces, leading underscores, or Unicode. The adapter maps them to distinct native actions. Reserve the native `compat-` and `compat_` prefixes for it instead of registering native actions under those prefixes yourself. The native API's simple action-name rule remains unchanged.

Function references are resolved locally by identity. If the same callback has multiple registered names, the first remaining matching registration is selected. Functions are never serialized or sent to another client. Repeating a registration is idempotent only with the same callback, the same authorization function, and an unchanged owned native registration. Conflicting or externally replaced registrations are rejected.

Arguments must be JSON-serializable values. Documents, functions, undefined arguments, class instances, and cyclic data are not supported. JSON results pass through unchanged. A handler may return `undefined` or omit its return; the adapter preserves that result with an internal result envelope. This exception for void results does not permit undefined values nested inside result objects or arrays.

The final argument is always handler data. For example, `executeAsGM("readSummary", { timeout: 5000 })` passes that object to the handler; it does not configure a timeout. The proxy uses the native service's configured timeout, 10,000 ms by default. Use the native API if you need per-call timeout options. There are no automatic retries, and a timeout does not cancel an action that may already be running.

Registration defaults to GM caller authorization. An optional `authorize(user, ...args)` policy may be asynchronous and must resolve to exactly `true`. The `user` is the canonical active User resolved through core query context. A claimed sender in an argument cannot replace it. Callers also need Foundry's [QUERY_USER permission](https://foundryvtt.com/api/v14/variables/CONST.USER_PERMISSIONS.html); running a handler on a GM does not waive its authorization policy.

Ordinary function callbacks receive a frozen `this` context containing a frozen `socketdata` object with the canonical caller's `userId`. Arrow callbacks keep their lexical `this`; use the authorization policy for caller-aware validation or an ordinary function when the handler needs that context. Validate feature-specific fields, ownership, and permissions before making changes. The internal argument envelope is exactly `{ args: [...] }`; callers should use the public methods rather than invoking compatibility query names directly.

## Broadcast errors and lifecycle helpers

An inactive proxy, unknown handler reference, lost registration ownership, or a non-array `executeForUsers` recipient list rejects before dispatch. After a broadcast starts, native JSON, permission, handler, and transport failures are reported separately. They do not retroactively reject the broadcast promise.

The cached `.compat` proxy reports those failures with `logger.error`. For a feature that needs its own reporter, construct a separate proxy and register its handlers on every client during init:

```js
import { SocketlibProxy } from "./socketlib-proxy.js";
import { moduleSocket } from "./socket.js";

const featureSocket = new SocketlibProxy(moduleSocket, {
    onError(error, { method, action, userId }) {
        console.error("Feature broadcast failed", { method, action, userId }, error);
    },
});
```

The constructor is `new SocketlibProxy(nativeSocket, { getGame, onError } = {})`. The optional `getGame` provider defaults to the current global game. Each instance owns its registrations; a separate proxy does not inherit the cached proxy's built-in `getStatus` registration. Use distinct handler names when proxies share a native service.

The reporter receives the compatibility method name, the original registered action name, and a `userId` when a particular recipient failed. Its context is frozen. Exceptions or rejected promises from a custom reporter are contained and logged rather than becoming unhandled background rejections.

The extension `unregister(name)` removes only a registration still owned by that proxy and returns whether it removed it. `dispose()` removes the proxy's owned registrations without deactivating the native service or deleting another owner's replacement. Disposing the native service also cleans up its cached proxy. These helpers are local lifecycle extensions, not promises to reproduce socketlib internals.

## Runtime validation

The repository has controlled tests for this adapter, but no real Foundry multiplayer result is claimed. Before relying on it in a derived module:

1. Use a supported Foundry 14 build with GM and player clients. Confirm readiness and that both public `.compat` paths return the same active proxy.
2. Exercise the built-in `getStatus` and a feature handler by name and callback reference. Confirm results, void results, and canonical caller identity on self and remote targets.
3. Check current-GM preference with multiple GMs, player selection of the active GM, and the no-GM case. Test a denied QUERY_USER permission and an unauthorized action.
4. Start broadcasts with a delayed handler, including the current client. Confirm the returned promise completes before that handler and that recipient failures reach the reporter without unhandled rejections.
5. Check disconnected recipients, timeouts, recipient-array preservation, and cleanup after registration replacement. Confirm that the unchanged native multi-user API still returns per-user settled outcomes.

Record the exact build, roles, and outcomes in [verification](verification.md). Leave `compatibility.verified` unset until the module has actually passed its runtime checks.

## Contract references

The supported instance signatures were reviewed against the official [socketlib README](https://github.com/farling42/foundryvtt-socketlib/blob/develop/README.md) and [instance implementation](https://github.com/farling42/foundryvtt-socketlib/blob/develop/src/socketlib.js). These are API references; no socketlib implementation was copied. The transport remains Foundry's [CONFIG.queries](https://foundryvtt.com/api/v14/variables/CONFIG.queries.html), [User.query](https://foundryvtt.com/api/v14/classes/foundry.documents.User.html#query), and [User.queryMany](https://foundryvtt.com/api/v14/classes/foundry.documents.User.html#queryMany).

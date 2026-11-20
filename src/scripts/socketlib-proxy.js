import { logger } from "./logger.js";

const allowGM = (user) => user.isGM === true;
const reportBroadcastError = (error, context) =>
  logger.error(`Socket compatibility ${context.method} failed`, context, error);

function validateName(name) {
  if (typeof name !== "string" || !name.length) throw new TypeError("Socket proxy names must be nonempty strings.");
}

function nativeAction(name) {
  if (/^[A-Za-z][A-Za-z0-9_-]*$/u.test(name)) return `compat-${name}`;
  // A disjoint prefix and code-point delimiters keep legacy names unambiguous.
  return `compat_${Array.from(name, (character) => character.codePointAt(0).toString(16)).join("-")}`;
}

function readEnvelope(envelope, key) {
  if (
    !envelope ||
    typeof envelope !== "object" ||
    Array.isArray(envelope) ||
    Object.keys(envelope).length !== 1 ||
    !Object.hasOwn(envelope, key) ||
    !Array.isArray(envelope[key])
  ) {
    throw new TypeError(`Invalid socket proxy ${key} envelope.`);
  }
  return envelope[key];
}

function readResult(envelope) {
  const result = readEnvelope(envelope, "result");
  if (result.length > 1) throw new TypeError("Invalid socket proxy result envelope.");
  return result[0];
}

/** Socketlib-style instance methods over ModuleSocket, without a second transport. */
export class SocketlibProxy {
  #socket;
  #getGame;
  #onError;
  #registrations = new Map();

  constructor(socket, { getGame = () => globalThis.game, onError = reportBroadcastError } = {}) {
    for (const method of [
      "register",
      "unregister",
      "ownsRegistration",
      "executeAsGM",
      "executeAsUser",
      "executeForUsers",
      "executeForEveryone",
      "executeForOthers",
    ]) {
      if (typeof socket?.[method] !== "function") throw new TypeError("A native ModuleSocket service is required.");
    }
    if (typeof getGame !== "function" || typeof onError !== "function") {
      throw new TypeError("Socket proxy environment and error reporter must be functions.");
    }
    this.#socket = socket;
    this.#getGame = getGame;
    this.#onError = onError;
  }

  get active() {
    return this.#socket.active;
  }

  get provider() {
    return this.#socket.provider;
  }

  /** Register on every client during init. authorize receives (user, ...args). */
  register(name, handler, { authorize = allowGM } = {}) {
    validateName(name);
    if (typeof handler !== "function" || typeof authorize !== "function") {
      throw new TypeError("Socket proxy handlers and authorization policies must be functions.");
    }
    const existing = this.#registrations.get(name);
    if (existing) {
      if (existing.handler !== handler || existing.authorize !== authorize) {
        throw new Error(`Socket proxy action is already registered: ${name}`);
      }
      if (!this.#socket.ownsRegistration(existing.action, existing.receiver)) {
        throw new Error(`Socket proxy registration is no longer owned by this proxy: ${name}`);
      }
      return;
    }
    const action = nativeAction(name);
    const receiver = async (payload, { user }) => {
      const args = readEnvelope(payload, "args");
      const context = Object.freeze({ socketdata: Object.freeze({ userId: user.id }) });
      const result = await Reflect.apply(handler, context, args);
      return { result: result === undefined ? [] : [result] };
    };
    this.#socket.register(action, receiver, {
      authorize: (user, payload) => authorize(user, ...readEnvelope(payload, "args")),
    });
    this.#registrations.set(name, { name, action, handler, authorize, receiver });
  }

  /** Extension: remove only a registration still owned by this proxy. */
  unregister(name) {
    validateName(name);
    const registration = this.#registrations.get(name);
    if (!registration) return false;
    const owned = this.#socket.ownsRegistration(registration.action, registration.receiver);
    if (owned) this.#socket.unregister(registration.action);
    this.#registrations.delete(name);
    return owned;
  }

  /** Extension: release this proxy's registrations without deactivating the native service. */
  dispose() {
    for (const name of this.#registrations.keys()) this.unregister(name);
  }

  #registration(handler) {
    if (!this.active) throw new Error("Socket proxy service is not active.");
    const registration =
      typeof handler === "function"
        ? [...this.#registrations.values()].find((entry) => entry.handler === handler)
        : this.#registrations.get(handler);
    if (!registration) throw new Error("Socket proxy handler is not registered.");
    if (!this.#socket.ownsRegistration(registration.action, registration.receiver)) {
      throw new Error(`Socket proxy registration is no longer owned by this proxy: ${registration.name}`);
    }
    return registration;
  }

  #world() {
    const game = this.#getGame();
    if (!game?.users || typeof game.users.get !== "function" || typeof game.users.filter !== "function") {
      throw new Error("Foundry users are unavailable to the socket proxy.");
    }
    const user = game.users.get(game.user?.id);
    if (!user?.active) throw new Error("The current socket proxy user is missing or inactive.");
    return { game, user };
  }

  async executeAsGM(handler, ...args) {
    const { action } = this.#registration(handler);
    const { user } = this.#world();
    const result = user.isGM
      ? await this.#socket.executeAsUser(action, user.id, { args })
      : await this.#socket.executeAsGM(action, { args });
    return readResult(result);
  }

  async executeAsUser(handler, userId, ...args) {
    const { action } = this.#registration(handler);
    return readResult(await this.#socket.executeAsUser(action, userId, { args }));
  }

  #report(error, context) {
    void Promise.resolve()
      .then(() => this.#onError(error, Object.freeze(context)))
      .catch((reportingError) => {
        // A failed custom reporter must not leave a detached rejection behind.
        try {
          logger.error("Socket compatibility error reporting failed", reportingError, error);
        } catch {
          /* Reporting cannot change a fire-and-forget call's outcome. */
        }
      });
  }

  #broadcast(method, registration, dispatch) {
    const context = { method, action: registration.name };
    let pending;
    try {
      pending = dispatch();
    } catch (error) {
      this.#report(error, context);
      return;
    }
    void Promise.resolve(pending)
      .then((results) => {
        if (!(results instanceof Map)) throw new TypeError("Native broadcast results must be a Map.");
        for (const [user, outcome] of results) {
          if (outcome.status === "rejected") this.#report(outcome.reason, { ...context, userId: user.id });
        }
      })
      .catch((error) => this.#report(error, context));
  }

  async executeForAllGMs(handler, ...args) {
    const registration = this.#registration(handler);
    const { game } = this.#world();
    const ids = game.users.filter((user) => user.active && user.isGM).map((user) => user.id);
    this.#broadcast("executeForAllGMs", registration, () =>
      this.#socket.executeForUsers(registration.action, ids, { args }),
    );
  }

  async executeForOtherGMs(handler, ...args) {
    const registration = this.#registration(handler);
    const { game, user: current } = this.#world();
    const ids = game.users.filter((user) => user.active && user.isGM && user.id !== current.id).map((user) => user.id);
    this.#broadcast("executeForOtherGMs", registration, () =>
      this.#socket.executeForUsers(registration.action, ids, { args }),
    );
  }

  async executeForEveryone(handler, ...args) {
    const registration = this.#registration(handler);
    this.#broadcast("executeForEveryone", registration, () =>
      this.#socket.executeForEveryone(registration.action, { args }),
    );
  }

  async executeForOthers(handler, ...args) {
    const registration = this.#registration(handler);
    this.#broadcast("executeForOthers", registration, () =>
      this.#socket.executeForOthers(registration.action, { args }),
    );
  }

  async executeForUsers(handler, userIds, ...args) {
    const registration = this.#registration(handler);
    if (!Array.isArray(userIds)) throw new TypeError("Socket proxy recipients must be an array of user ids.");
    const { game } = this.#world();
    const ids = [...new Set(userIds)].filter((id) => typeof id === "string" && game.users.get(id)?.active);
    this.#broadcast("executeForUsers", registration, () =>
      this.#socket.executeForUsers(registration.action, ids, { args }),
    );
  }
}

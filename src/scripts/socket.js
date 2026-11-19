import { MODULE_ID } from "./constants.js";

const MAX_TIMEOUT = 2_147_483_647;
const allowGM = (user) => user.isGM === true;

function validateTimeout(timeout) {
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > MAX_TIMEOUT) {
    throw new TypeError(`Socket timeout must be a positive number no greater than ${MAX_TIMEOUT} milliseconds.`);
  }
  return timeout;
}

function validateAction(action) {
  if (typeof action !== "string" || !/^[A-Za-z][A-Za-z0-9_-]*$/u.test(action)) {
    throw new TypeError(
      "Socket action must start with a letter and contain only letters, digits, underscores, or hyphens.",
    );
  }
}

function validateJson(value, ancestors = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (
    typeof value !== "object" ||
    ancestors.has(value) ||
    (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) ||
    Object.getOwnPropertySymbols(value).length
  ) {
    throw new TypeError("Socket data must contain only JSON values, without cycles or class instances.");
  }
  ancestors.add(value);
  for (const item of Array.isArray(value) ? value : Object.values(value)) validateJson(item, ancestors);
  ancestors.delete(value);
}

function validatePayload(payload) {
  if (payload === null || typeof payload !== "object") {
    throw new TypeError("Socket payload must be a JSON object or array.");
  }
  validateJson(payload);
}

/** A small adapter over Foundry V14 User queries; it does not implement a second RPC protocol. */
export class ModuleSocket {
  #moduleId;
  #getGame;
  #getConfig;
  #getUserClass;
  #timeout;
  #active = false;
  #registrations = new Map();

  constructor({
    moduleId = MODULE_ID,
    getGame = () => globalThis.game,
    getConfig = () => globalThis.CONFIG,
    getUserClass = () => globalThis.foundry?.documents?.User,
    timeout = 10_000,
  } = {}) {
    if (typeof moduleId !== "string" || !/^[a-z][a-z0-9-]*$/u.test(moduleId)) {
      throw new TypeError("Socket module id must be a lowercase module identifier.");
    }
    if (![getGame, getConfig, getUserClass].every((getter) => typeof getter === "function")) {
      throw new TypeError("Socket environment getters must be functions.");
    }
    this.#moduleId = moduleId;
    this.#getGame = getGame;
    this.#getConfig = getConfig;
    this.#getUserClass = getUserClass;
    this.#timeout = validateTimeout(timeout);
  }

  get provider() {
    return "foundry";
  }

  get active() {
    return this.#active;
  }

  /** Register on every client during init. authorize(user, payload) must resolve to true. */
  register(action, handler, { authorize = allowGM } = {}) {
    validateAction(action);
    if (typeof handler !== "function" || typeof authorize !== "function") {
      throw new TypeError("Socket handlers and authorization policies must be functions.");
    }
    const registry = this.#getConfig()?.queries;
    if (!registry || typeof registry !== "object") throw new Error("Foundry's query registry is unavailable.");
    const name = `${this.#moduleId}.${action}`;
    const existing = this.#registrations.get(action);
    if (existing) {
      if (
        existing.handler === handler &&
        existing.authorize === authorize &&
        existing.registry === registry &&
        registry[name] === existing.receiver
      )
        return this;
      throw new Error(`Socket action is already registered or its registration was replaced: ${action}`);
    }
    if (name in registry) throw new Error(`Foundry query is already registered: ${name}`);
    const receiver = (payload, context) => this.#receive(action, payload, context);
    registry[name] = receiver;
    this.#registrations.set(action, { name, registry, receiver, handler, authorize });
    return this;
  }

  activate() {
    this.#active = true;
    return this;
  }

  deactivate() {
    this.#active = false;
    return this;
  }

  unregister(action) {
    validateAction(action);
    const registration = this.#registrations.get(action);
    if (!registration) return false;
    if (registration.registry[registration.name] === registration.receiver) {
      delete registration.registry[registration.name];
    }
    this.#registrations.delete(action);
    return true;
  }

  dispose() {
    this.deactivate();
    for (const action of this.#registrations.keys()) this.unregister(action);
  }

  #registration(action) {
    validateAction(action);
    const registration = this.#registrations.get(action);
    if (!registration || registration.registry[registration.name] !== registration.receiver) {
      throw new Error(`Socket action is not registered by this service: ${action}`);
    }
    return registration;
  }

  #game() {
    if (!this.#active) throw new Error("Socket service is not active.");
    const game = this.#getGame();
    if (!game?.users || typeof game.users.get !== "function") throw new Error("Foundry users are unavailable.");
    return game;
  }

  #user(game, id, label) {
    const user = typeof id === "string" && id ? game.users.get(id) : undefined;
    if (!user) throw new Error(`${label} is missing or unknown.`);
    if (!user.active) throw new Error(`${label} is not active.`);
    return user;
  }

  async #receive(action, payload, { user: contextUser } = {}) {
    const game = this.#game();
    const registration = this.#registration(action);
    const user = this.#user(game, typeof contextUser === "string" ? contextUser : contextUser?.id, "Query sender");
    validatePayload(payload);
    if ((await registration.authorize(user, payload)) !== true) {
      throw new Error(`Query sender is not authorized for socket action: ${action}`);
    }
    // Payload fields never override the canonical User supplied through core's query context.
    const result = await registration.handler(payload, { user });
    validateJson(result);
    return result;
  }

  #prepare(action, payload, options) {
    const game = this.#game();
    const { name } = this.#registration(action);
    validatePayload(payload);
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new TypeError("Socket options must be an object.");
    }
    const timeout = validateTimeout(options.timeout === undefined ? this.#timeout : options.timeout);
    const user = this.#user(game, game.user?.id, "Current user");
    if (typeof user.can !== "function" || !user.can("QUERY_USER")) {
      throw new Error("The current user does not have the QUERY_USER permission.");
    }
    return { game, name, options: { timeout } };
  }

  #query(request, userId, payload) {
    const target = this.#user(request.game, userId, "Query target");
    if (typeof target.query !== "function") throw new Error("Native Foundry User queries are unavailable.");
    // Self-targets also use core's query path; no local authorization or timeout bypass.
    return target.query(request.name, payload, request.options);
  }

  async executeAsUser(action, userId, payload = {}, options = {}) {
    return this.#query(this.#prepare(action, payload, options), userId, payload);
  }

  async executeAsGM(action, payload = {}, options = {}) {
    const request = this.#prepare(action, payload, options);
    const gm = request.game.users.activeGM;
    if (!gm?.active || !gm.isGM) throw new Error("No active GM is available for the socket action.");
    return this.#query(request, gm.id, payload);
  }

  #queryMany(request, userIds, payload) {
    if (!userIds || typeof userIds === "string" || typeof userIds[Symbol.iterator] !== "function") {
      throw new TypeError("Socket user ids must be an iterable of user identifiers.");
    }
    const targets = [...new Set(userIds)].map((id) => this.#user(request.game, id, "Query target"));
    if (!targets.length) return new Map();
    const UserClass = this.#getUserClass();
    if (typeof UserClass?.queryMany !== "function") throw new Error("Native Foundry User.queryMany is unavailable.");
    return UserClass.queryMany(targets, request.name, payload, request.options);
  }

  /** Return core's Map<User, PromiseSettledResult> unchanged. Duplicate recipients are queried once. */
  async executeForUsers(action, userIds, payload = {}, options = {}) {
    return this.#queryMany(this.#prepare(action, payload, options), userIds, payload);
  }

  async executeForEveryone(action, payload = {}, options = {}) {
    const request = this.#prepare(action, payload, options);
    const ids = request.game.users.filter((user) => user.active).map((user) => user.id);
    return this.#queryMany(request, ids, payload);
  }

  async executeForOthers(action, payload = {}, options = {}) {
    const request = this.#prepare(action, payload, options);
    const ids = request.game.users
      .filter((user) => user.active && user.id !== request.game.user.id)
      .map((user) => user.id);
    return this.#queryMany(request, ids, payload);
  }
}

// Importing the module does not inspect Foundry globals or register any remote operations.
export const moduleSocket = new ModuleSocket();

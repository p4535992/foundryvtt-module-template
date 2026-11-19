import { moduleApi } from "./api.js";
import { moduleSocket } from "./socket.js";

function getStatus() {
  return moduleApi.getStatus();
}

function allowActiveUser(user) {
  return user.active;
}

/** Register each named operation on every client during init. */
export function registerSocketHandlers() {
  moduleSocket.register("getStatus", getStatus, { authorize: allowActiveUser });
}

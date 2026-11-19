// SPDX-License-Identifier: MIT
// Copyright © 2021 fvtt-lib-wrapper Rui Pinheiro
// Adapted from the shim distributed by DFreds/dfreds-module-template-ts.
// Local changes: JavaScript, lazy selection, explicit validation, no eager dialog,
// and globalThis-only target resolution instead of eval.

function parseTarget(target) {
  const parts = [];
  let position = 0;
  const expression = /([A-Za-z_$][\w$]*)|\[(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")\]/y;
  while (position < target.length) {
    expression.lastIndex = position;
    const match = expression.exec(target);
    if (!match || (position === 0 && !match[1])) {
      throw new Error(`libWrapper fallback: invalid target '${target}'.`);
    }
    parts.push((match[1] ?? match[2] ?? match[3]).replace(/\\(.)/g, "$1"));
    position = expression.lastIndex;
    if (position === target.length) break;
    if (target[position] === ".") {
      position += 1;
      if (!/[A-Za-z_$]/.test(target[position] ?? "")) {
        throw new Error(`libWrapper fallback: invalid target '${target}'.`);
      }
    } else if (target[position] !== "[") {
      throw new Error(`libWrapper fallback: invalid target '${target}'.`);
    }
  }
  return parts;
}

/**
 * A small compatibility fallback, not the full libWrapper API. It only handles
 * targets reachable from globalThis and does not implement unregister/conflicts.
 */
export class LibWrapperFallback {
  static get is_fallback() {
    return true;
  }

  static get WRAPPER() {
    return "WRAPPER";
  }

  static get MIXED() {
    return "MIXED";
  }

  static get OVERRIDE() {
    return "OVERRIDE";
  }

  static get LISTENER() {
    return "LISTENER";
  }

  static register(packageId, target, callback, type = "MIXED", { chain, bind = [] } = {}) {
    if (!packageId || typeof target !== "string" || typeof callback !== "function") {
      throw new TypeError("libWrapper fallback requires a package ID, target string, and callback.");
    }
    const isSetter = target.endsWith("#set");
    const propertyPath = isSetter ? target.slice(0, -4) : target;
    const parts = parseTarget(propertyPath);
    const property = parts.pop();
    const owner = parts.reduce((value, key) => value?.[key], globalThis);
    if (!owner) throw new Error(`libWrapper fallback: target '${target}' is not available on globalThis.`);

    let ancestor = owner;
    let descriptor;
    while (ancestor && !descriptor) {
      descriptor = Object.getOwnPropertyDescriptor(ancestor, property);
      ancestor = Object.getPrototypeOf(ancestor);
    }
    if (!descriptor || descriptor.configurable === false) {
      throw new Error(`libWrapper fallback: '${target}' is missing or non-configurable.`);
    }

    const original = isSetter ? descriptor.set : descriptor.value ?? descriptor.get;
    if (typeof original !== "function") {
      throw new TypeError(`libWrapper fallback: '${target}' is not a callable method or accessor.`);
    }

    const normalizedType = typeof type === "string" ? type.toUpperCase() : type;
    const isOverride = normalizedType === "OVERRIDE" || normalizedType === 3;
    const isListener = normalizedType === "LISTENER" || normalizedType === 4;
    const wrapper = isListener
      ? function (...args) {
          callback.call(this, ...bind, ...args);
          return original.call(this, ...args);
        }
      : (chain ?? !isOverride)
        ? function (...args) {
            return callback.call(this, original.bind(this), ...bind, ...args);
          }
        : function (...args) {
            return callback.call(this, ...bind, ...args);
          };

    if (isSetter) descriptor.set = wrapper;
    else if ("value" in descriptor) descriptor.value = wrapper;
    else descriptor.get = wrapper;
    Object.defineProperty(owner, property, descriptor);
  }
}

export function getLibWrapper() {
  const implementation = globalThis.libWrapper;
  if (implementation?.is_fallback === false && typeof implementation.register === "function") {
    return implementation;
  }
  return LibWrapperFallback;
}

import { config } from "dotenv";
import "@testing-library/jest-dom";

// Load non-VITE_ env vars (DATABASE_URL, etc.) from .env.local before any
// test file imports modules that read process.env at import time (notably
// src/db/index.ts). Vitest / Vite only expose VITE_ prefixed vars natively.
config({ path: ".env.local" });

// Node 25 ships a partial global `localStorage` object that exists but has no
// methods (getItem / setItem / clear / removeItem are all undefined). When
// vitest runs a `@vitest-environment jsdom` test, it sets up a proper
// localStorage on `jsdom.window`, but the `populateGlobal` utility skips
// overriding keys that already exist in the Node global and are not in its
// hardcoded KEYS allowlist — so `global.localStorage` stays as the Node stub.
//
// Fix: whenever jsdom has set up its own window storage objects, forward them
// to the global scope so test code can call `localStorage.clear()` etc.
// jsdom ships no ResizeObserver, which components that pin/measure elements
// (solver tab bar, timeline spine) construct on mount. A no-op stub lets them
// render under test; individual tests can still override with a richer fake.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as typeof ResizeObserver;
}

const jsdomWindow = (globalThis as { jsdom?: { window: Window & typeof globalThis } }).jsdom
  ?.window;
if (jsdomWindow) {
  if (jsdomWindow.localStorage) {
    Object.defineProperty(globalThis, "localStorage", {
      value: jsdomWindow.localStorage,
      writable: true,
      configurable: true,
    });
  }
  if (jsdomWindow.sessionStorage) {
    Object.defineProperty(globalThis, "sessionStorage", {
      value: jsdomWindow.sessionStorage,
      writable: true,
      configurable: true,
    });
  }
}

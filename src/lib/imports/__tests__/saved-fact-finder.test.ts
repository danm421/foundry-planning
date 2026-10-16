// src/lib/imports/__tests__/saved-fact-finder.test.ts
import { describe, expect, it } from "vitest";
import { FACT_FINDER_ONLY_MESSAGE, refuseFactFinderImport } from "../saved-fact-finder";

describe("refuseFactFinderImport", () => {
  it.each([
    ["an open fact finder", { factFinder: { version: 0 } }],
    ["a saved fact finder", { factFinder: { version: 3, closed: { at: "2026-10-16T09:00:00.000Z" } } }],
    ["a statement-chat import", { chat: { surface: "chat" } }],
  ])("answers 409 with the fact finder message for %s", async (_name, payloadJson) => {
    const res = refuseFactFinderImport({ payloadJson });
    expect(res?.status).toBe(409);
    expect(await res?.json()).toEqual({ error: FACT_FINDER_ONLY_MESSAGE });
  });

  it.each([
    ["a wizard import", { fileResults: {}, payload: { accounts: [] } }],
    ["an empty payload", {}],
    ["no payload", null],
  ])("lets %s through", (_name, payloadJson) => {
    expect(refuseFactFinderImport({ payloadJson })).toBeNull();
  });
});

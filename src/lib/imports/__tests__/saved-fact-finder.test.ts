// src/lib/imports/__tests__/saved-fact-finder.test.ts
import { describe, expect, it } from "vitest";
import { SAVE_CLOSED_MESSAGE } from "@/lib/fact-finder/api-types";
import { readFactFinderState } from "@/lib/fact-finder/state";
import { FACT_FINDER_ONLY_MESSAGE, refuseFactFinderImport, refuseSavedFactFinderWithState } from "../saved-fact-finder";

describe("refuseFactFinderImport", () => {
  it.each([
    ["an open fact finder", { factFinder: { version: 0 } }],
    ["a statement-chat import", { chat: { surface: "chat" } }],
  ])("answers 409 with the fact finder message for %s", async (_name, payloadJson) => {
    const res = refuseFactFinderImport({ payloadJson });
    expect(res?.status).toBe(409);
    expect(await res?.json()).toEqual({ error: FACT_FINDER_ONLY_MESSAGE });
  });

  it("answers 409 with the saved message, and no fact finder, for a saved fact finder", async () => {
    const res = refuseFactFinderImport({
      payloadJson: { factFinder: { version: 3, closed: { at: "2026-10-16T09:00:00.000Z" } } },
    });
    expect(res?.status).toBe(409);
    expect(await res?.json()).toEqual({ error: SAVE_CLOSED_MESSAGE });
  });

  it.each([
    ["a wizard import", { fileResults: {}, payload: { accounts: [] } }],
    ["an empty payload", {}],
    ["no payload", null],
  ])("lets %s through", (_name, payloadJson) => {
    expect(refuseFactFinderImport({ payloadJson })).toBeNull();
  });
});

describe("refuseSavedFactFinderWithState", () => {
  it("answers 409 with the saved fact finder in the body", async () => {
    const payloadJson = { factFinder: { version: 3, closed: { at: "2026-10-16T09:00:00.000Z" } } };
    const res = refuseSavedFactFinderWithState({ payloadJson });
    expect(res?.status).toBe(409);
    expect(await res?.json()).toEqual({ error: SAVE_CLOSED_MESSAGE, factFinder: readFactFinderState(payloadJson) });
  });

  it.each([
    ["an open fact finder", { factFinder: { version: 0 } }],
    ["a wizard import", { fileResults: {}, payload: { accounts: [] } }],
    ["no payload", null],
  ])("lets %s through", (_name, payloadJson) => {
    expect(refuseSavedFactFinderWithState({ payloadJson })).toBeNull();
  });
});

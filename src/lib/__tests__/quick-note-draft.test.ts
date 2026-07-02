// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  quickNoteDraftKey,
  readQuickNoteDraft,
  writeQuickNoteDraft,
  clearQuickNoteDraft,
  hasQuickNoteDraft,
} from "../quick-note-draft";

const CLIENT = "client-1";
const USER = "user_abc";

describe("quick-note draft storage", () => {
  beforeEach(() => window.localStorage.clear());

  it("keys drafts per client and user", () => {
    expect(quickNoteDraftKey(CLIENT, USER)).toBe("foundry.crmNoteDraft:client-1:user_abc");
  });

  it("round-trips a draft body", () => {
    writeQuickNoteDraft(CLIENT, USER, "Call notes **draft**");
    expect(readQuickNoteDraft(CLIENT, USER)).toBe("Call notes **draft**");
    expect(hasQuickNoteDraft(CLIENT, USER)).toBe(true);
  });

  it("removes the key when the body is emptied", () => {
    writeQuickNoteDraft(CLIENT, USER, "something");
    writeQuickNoteDraft(CLIENT, USER, "   ");
    expect(window.localStorage.getItem(quickNoteDraftKey(CLIENT, USER))).toBeNull();
    expect(hasQuickNoteDraft(CLIENT, USER)).toBe(false);
  });

  it("clears on demand", () => {
    writeQuickNoteDraft(CLIENT, USER, "something");
    clearQuickNoteDraft(CLIENT, USER);
    expect(readQuickNoteDraft(CLIENT, USER)).toBeNull();
  });

  it("discards drafts with a mismatched version", () => {
    window.localStorage.setItem(
      quickNoteDraftKey(CLIENT, USER),
      JSON.stringify({ v: 99, body: "old shape", updatedAt: "2026-01-01T00:00:00.000Z" }),
    );
    expect(readQuickNoteDraft(CLIENT, USER)).toBeNull();
  });

  it("treats corrupt JSON as no draft", () => {
    window.localStorage.setItem(quickNoteDraftKey(CLIENT, USER), "{not json");
    expect(readQuickNoteDraft(CLIENT, USER)).toBeNull();
    expect(hasQuickNoteDraft(CLIENT, USER)).toBe(false);
  });
});

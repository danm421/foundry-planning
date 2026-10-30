import { describe, it, expect } from "vitest";
import type { WorkspaceEvent } from "./types";
import { adapterFor, canEditEvent } from "./provider-adapter";
import { microsoftAdapter } from "./microsoft/adapter";

describe("canEditEvent", () => {
  const base = { isOrganizer: true, isCancelled: false } as WorkspaceEvent;
  it("is true only for a live event the advisor organizes", () => {
    expect(canEditEvent(base)).toBe(true);
    expect(canEditEvent({ ...base, isOrganizer: false })).toBe(false);
    expect(canEditEvent({ ...base, isCancelled: true })).toBe(false);
  });
});

describe("adapterFor", () => {
  it("returns the Microsoft adapter", () => {
    expect(adapterFor("microsoft")).toBe(microsoftAdapter);
  });
  it("has no Google adapter yet", () => {
    expect(() => adapterFor("google")).toThrow("Google adapter not built yet");
  });
});

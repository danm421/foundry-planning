import { describe, it, expect } from "vitest";
import { importScreenPath, isFactFinderImport } from "../import-kind";
import type { ImportPayloadJson } from "../types";

describe("isFactFinderImport", () => {
  it("is true for an import with a fact finder slice", () => {
    const payload = { factFinder: {} } as unknown as ImportPayloadJson;
    expect(isFactFinderImport(payload)).toBe(true);
  });

  it("is true for a statement-chat import from before the switch", () => {
    const payload = { chat: { surface: "chat" } } as unknown as ImportPayloadJson;
    expect(isFactFinderImport(payload)).toBe(true);
  });

  it("is false for a wizard import, an empty payload, null and undefined", () => {
    expect(isFactFinderImport({} as ImportPayloadJson)).toBe(false);
    expect(isFactFinderImport(null)).toBe(false);
    expect(isFactFinderImport(undefined)).toBe(false);
  });
});

describe("importScreenPath", () => {
  it("points a fact finder import at the fact finder screen", () => {
    expect(importScreenPath("c1", "i1", true)).toBe("/clients/c1/details/import/i1/fact-finder");
  });

  it("points a wizard import at the wizard", () => {
    expect(importScreenPath("c1", "i1", false)).toBe("/clients/c1/details/import/i1");
  });
});

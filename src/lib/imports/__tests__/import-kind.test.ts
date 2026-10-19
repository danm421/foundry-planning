import { describe, it, expect } from "vitest";
import { importScreenPath, isFactFinderImport, isFinishedInStatementChat } from "../import-kind";
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

describe("isFinishedInStatementChat", () => {
  const SAVED = { factFinder: { closed: { at: "2026-10-16T09:00:00.000Z" } } } as unknown as ImportPayloadJson;
  const STATEMENT_CHAT = { chat: { surface: "chat" } } as unknown as ImportPayloadJson;

  it("is true for a committed statement-chat import with no saved fact finder", () => {
    expect(isFinishedInStatementChat("committed", STATEMENT_CHAT)).toBe(true);
  });

  it("is false for a saved fact finder, an open one, and a finished wizard import", () => {
    expect(isFinishedInStatementChat("committed", SAVED)).toBe(false);
    expect(isFinishedInStatementChat("review", STATEMENT_CHAT)).toBe(false);
    expect(isFinishedInStatementChat("committed", { payload: { accounts: [] } } as unknown as ImportPayloadJson)).toBe(false);
  });
});

describe("importScreenPath", () => {
  it("import-kind stays a leaf: client components import it on every page", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("../import-kind.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from "@\/lib\/fact-finder\//);
  });

  it("points a fact finder import at the fact finder screen", () => {
    expect(importScreenPath("c1", "i1", true)).toBe("/clients/c1/details/import/i1/fact-finder");
  });

  it("points a wizard import at the wizard", () => {
    expect(importScreenPath("c1", "i1", false)).toBe("/clients/c1/details/import/i1");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock factories are hoisted above top-level `const`s, so referencing
// plain `const listDocuments = vi.fn()` here throws a TDZ ReferenceError —
// vi.hoisted() runs before that hoist and gives the factory something
// already initialized to close over.
const { listDocuments, getState } = vi.hoisted(() => ({
  listDocuments: vi.fn(),
  getState: vi.fn(),
}));
vi.mock("@/lib/tax-returns/documents-store", () => ({
  listDocuments, getState, rowToMergeDocument: (r: unknown) => r,
}));

import { loadDocumentContext } from "../assemble-analysis";

describe("loadDocumentContext", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the documents and state when the tables exist", async () => {
    listDocuments.mockResolvedValue([{ id: "d1" }]);
    getState.mockResolvedValue({ factsOverrides: { "income.agi": 1 } });

    const ctx = await loadDocumentContext("row-1");

    expect(ctx.documents).toHaveLength(1);
    expect(ctx.overrides).toEqual({ "income.agi": 1 });
    expect(ctx.unavailable).toBe(false);
  });

  it("degrades to empty when the relation does not exist yet", async () => {
    // Postgres undefined_table — the deploy-before-migrate window.
    listDocuments.mockRejectedValue(Object.assign(new Error("relation \"tax_return_documents\" does not exist"), { code: "42P01" }));
    getState.mockResolvedValue(null);

    const ctx = await loadDocumentContext("row-1");

    expect(ctx.documents).toEqual([]);
    expect(ctx.unavailable).toBe(true);
  });

  it("rethrows any other database error", async () => {
    listDocuments.mockRejectedValue(Object.assign(new Error("connection terminated"), { code: "57P01" }));
    await expect(loadDocumentContext("row-1")).rejects.toThrow("connection terminated");
  });

  // A real Postgres 42P01 never reaches here as a flat `{ code }` — Drizzle
  // wraps every driver error in DrizzleQueryError, whose own `.code` is
  // undefined, and nests the actual Postgres error (with `.code`) under
  // `.cause`. This pins that unwrap: without it, a real deploy-before-migrate
  // error would rethrow as a 500 instead of degrading, exactly as it did in
  // the unmocked route test before `isUndefinedTable` learned to check
  // `.cause?.code` too.
  it("degrades on a DrizzleQueryError-shaped 42P01 nested under .cause", async () => {
    const pgError = Object.assign(
      new Error('relation "tax_return_documents" does not exist'),
      { code: "42P01" },
    );
    listDocuments.mockRejectedValue(
      Object.assign(new Error("Failed query: select ..."), { cause: pgError }),
    );
    getState.mockResolvedValue(null);

    const ctx = await loadDocumentContext("row-1");

    expect(ctx.documents).toEqual([]);
    expect(ctx.unavailable).toBe(true);
  });

  it("rethrows a DrizzleQueryError-shaped error whose nested cause is a different code", async () => {
    const pgError = Object.assign(new Error("deadlock detected"), { code: "40P01" });
    listDocuments.mockRejectedValue(
      Object.assign(new Error("Failed query: select ..."), { cause: pgError }),
    );
    await expect(loadDocumentContext("row-1")).rejects.toThrow("Failed query: select ...");
  });
});

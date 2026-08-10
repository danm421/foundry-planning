import { describe, it, expect, vi, beforeEach } from "vitest";
import { emptyTaxReturnFacts } from "@/lib/schemas/tax-return-facts";

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
    listDocuments.mockResolvedValue([
      {
        id: "d1", role: "full_return", filename: "1040.pdf", taxYear: 2024,
        warnings: [], createdAt: new Date("2026-08-01T00:00:00Z"),
        extractedFacts: null, supportingPayload: null,
      },
    ]);
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

  it("summarizes each document with its role, filename and W-2 pairs", async () => {
    vi.mocked(listDocuments).mockResolvedValue([
      {
        id: "doc-1", role: "full_return", filename: "1040.pdf", taxYear: 2024,
        warnings: [], createdAt: new Date("2026-08-01T00:00:00Z"),
        extractedFacts: emptyTaxReturnFacts(2024),
        // Populated on purpose: a null payload parses to `[]` anyway, so it
        // could not tell a working role gate from a missing one.
        supportingPayload: { w2s: [{ employer: "Should Be Ignored Inc", wages: 1 }] },
      },
      {
        id: "doc-2", role: "w2", filename: "w2-ridgeline.pdf", taxYear: 2024,
        warnings: ["Transcribed from an image."], createdAt: new Date("2026-08-02T00:00:00Z"),
        extractedFacts: null,
        supportingPayload: { w2s: [{ employer: "Ridgeline Partners LLC", wages: 95_000 }] },
      },
    ] as never);
    vi.mocked(getState).mockResolvedValue({ taxReturnId: "r1", factsOverrides: {} } as never);

    const ctx = await loadDocumentContext("r1");

    expect(ctx.summaries).toHaveLength(2);
    expect(ctx.summaries[1]).toMatchObject({
      id: "doc-2", role: "w2", filename: "w2-ridgeline.pdf",
      warnings: ["Transcribed from an image."],
    });
    expect(ctx.summaries[1].w2s).toEqual([{ employer: "Ridgeline Partners LLC", wages: 95_000 }]);
    // The role gate, not the payload's emptiness, is what keeps this empty.
    expect(ctx.summaries[0].w2s).toEqual([]);
    // The strip renders the upload date off this field, and `toMatchObject`
    // above would not notice it going missing.
    expect(ctx.summaries[0].createdAt).toBe("2026-08-01T00:00:00.000Z");
  });

  it("reports summaries empty, not a crash, in the pre-migration window", async () => {
    vi.mocked(listDocuments).mockRejectedValue(
      Object.assign(new Error("relation does not exist"), { cause: { code: "42P01" } }),
    );
    vi.mocked(getState).mockResolvedValue(null);

    const ctx = await loadDocumentContext("r1");

    expect(ctx.unavailable).toBe(true);
    expect(ctx.summaries).toEqual([]);
  });
});

describe("loadDocumentContext — second read", () => {
  beforeEach(() => vi.clearAllMocks());

  const ITEMS = [{
    id: "sr-1", headline: "h", detail: "d",
    form: null, line: null, quotedValue: null, dismissed: false,
  }];
  const STORED = { generatedAt: "2026-08-10T12:00:00.000Z", warnings: [], items: ITEMS };

  function docs(ids: string[]) {
    return ids.map((id) => ({
      id, role: "full_return", filename: `${id}.pdf`, taxYear: 2024,
      warnings: [], createdAt: new Date("2026-08-01T00:00:00Z"),
      extractedFacts: null, supportingPayload: null,
    }));
  }

  it("reports fresh when the stored hash matches the current document set", async () => {
    const { secondReadDocHash } = await import("../second-read/doc-hash");
    const { SECOND_READ_VERSION } = await import("../second-read/types");
    listDocuments.mockResolvedValue(docs(["d1", "d2"]));
    getState.mockResolvedValue({
      factsOverrides: {},
      aiSecondRead: STORED,
      aiSecondReadDocHash: secondReadDocHash(["d1", "d2"]),
      aiSecondReadVersion: SECOND_READ_VERSION,
    });

    const ctx = await loadDocumentContext("row-1");
    expect(ctx.secondRead?.items).toHaveLength(1);
    expect(ctx.secondReadStale).toBe(false);
  });

  it("reports STALE once a document is added", async () => {
    const { secondReadDocHash } = await import("../second-read/doc-hash");
    const { SECOND_READ_VERSION } = await import("../second-read/types");
    listDocuments.mockResolvedValue(docs(["d1", "d2", "d3"]));
    getState.mockResolvedValue({
      factsOverrides: {},
      aiSecondRead: STORED,
      aiSecondReadDocHash: secondReadDocHash(["d1", "d2"]),
      aiSecondReadVersion: SECOND_READ_VERSION,
    });

    const ctx = await loadDocumentContext("row-1");
    expect(ctx.secondRead?.items).toHaveLength(1);
    expect(ctx.secondReadStale).toBe(true);
  });

  it("reports STALE when the prompt version moved on, even with the same documents", async () => {
    const { secondReadDocHash } = await import("../second-read/doc-hash");
    listDocuments.mockResolvedValue(docs(["d1"]));
    getState.mockResolvedValue({
      factsOverrides: {},
      aiSecondRead: STORED,
      aiSecondReadDocHash: secondReadDocHash(["d1"]),
      aiSecondReadVersion: "1999-01-01.1",
    });

    const ctx = await loadDocumentContext("row-1");
    expect(ctx.secondReadStale).toBe(true);
  });

  it("is null and not stale when no read has ever been generated", async () => {
    listDocuments.mockResolvedValue(docs(["d1"]));
    getState.mockResolvedValue({ factsOverrides: {}, aiSecondRead: null, aiSecondReadDocHash: null, aiSecondReadVersion: null });

    const ctx = await loadDocumentContext("row-1");
    expect(ctx.secondRead).toBeNull();
    expect(ctx.secondReadStale).toBe(false);
  });

  it("is null in the deploy-before-migrate window instead of throwing", async () => {
    listDocuments.mockRejectedValue(
      Object.assign(new Error('relation "tax_return_state" does not exist'), { code: "42P01" }),
    );
    const ctx = await loadDocumentContext("row-1");
    expect(ctx.secondRead).toBeNull();
    expect(ctx.secondReadStale).toBe(false);
    expect(ctx.unavailable).toBe(true);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { emptyTaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import {
  assembleFacts,
  recomputeFacts,
  MissingTaxReturnStateError,
  EmptyRecomputeError,
} from "../recompute";
import type { MergeDocument } from "../merge/types";

// Per-test control over what the store returns. `vi.hoisted` because the mock
// factories below are hoisted above these declarations.
const store = vi.hoisted(() => ({
  docs: [] as unknown[],
  state: null as null | { factsOverrides: Record<string, unknown> },
}));

vi.mock("../documents-store", () => ({
  listDocuments: vi.fn(async () => store.docs),
  rowToMergeDocument: vi.fn((row: unknown) => row),
  getState: vi.fn(async () => store.state),
}));

// The write is mocked so a REGRESSION cannot reach the real database. These
// tests assert that recomputeFacts refuses to write; if a guard were removed,
// an unmocked `db` would issue a genuine UPDATE against the dev branch that
// `.env.local` points at.
const writes = vi.hoisted(() => ({ count: 0, lastFacts: undefined as unknown }));
vi.mock("@/db", () => ({
  db: {
    update: () => ({
      set: (values: { facts: unknown }) => {
        writes.count += 1;
        writes.lastFacts = values.facts;
        return { where: async () => undefined };
      },
    }),
  },
}));

beforeEach(() => {
  store.docs = [];
  store.state = null;
  writes.count = 0;
  writes.lastFacts = undefined;
});

describe("assembleFacts", () => {
  it("is the identity for a single document with no overrides", () => {
    const facts = emptyTaxReturnFacts(2025);
    facts.income.wages = 250000;
    facts.income.agi = 412000;
    const doc: MergeDocument = { id: "a", role: "full_return", taxYear: 2025, facts };

    expect(assembleFacts(2025, [doc], {}).facts).toEqual(facts);
  });

  it("reproduces a hand-edited return from one document plus its diff", () => {
    // This is the backfill's correctness property: an existing row becomes one
    // synthetic document plus diff(facts, extractedFacts), and recompute must
    // return the original `facts` unchanged.
    const extracted = emptyTaxReturnFacts(2025);
    extracted.income.wages = 250000;
    extracted.income.agi = 412000;

    const corrected = structuredClone(extracted);
    corrected.income.agi = 418500;

    const doc: MergeDocument = { id: "a", role: "full_return", taxYear: 2025, facts: extracted };
    const overrides = { "income.agi": 418500 };

    expect(assembleFacts(2025, [doc], overrides).facts).toEqual(corrected);
  });

  it("keeps the advisor's edit when a later document disagrees", () => {
    const a = emptyTaxReturnFacts(2025);
    a.income.agi = 412000;
    const b = emptyTaxReturnFacts(2025);
    b.income.agi = 415000;

    const result = assembleFacts(2025, [
      { id: "a", role: "full_return", taxYear: 2025, facts: a },
      { id: "b", role: "full_return", taxYear: 2025, facts: b },
    ], { "income.agi": 418500 });

    expect(result.facts.income.agi).toBe(418500);
    expect(result.provenance["income.agi"]).toBe("advisor");
    // The document-level disagreement is still reported for the review form.
    expect(result.conflicts.map((c) => c.path)).toContain("income.agi");
  });

  it("produces facts that satisfy the strict schema", async () => {
    const { taxReturnFactsSchema } = await import("@/lib/schemas/tax-return-facts");
    const facts = emptyTaxReturnFacts(2025);
    facts.k1s = [{
      entityName: "Ridge Partners LLC", ein: "12-3456789", entityType: "partnership",
      ordinaryBusinessIncome: 42000, rentalIncome: null, guaranteedPayments: 30000,
      section179: null, w2WagesFromEntity: null, qbiIncome: 42000, isSstb: false,
    }];
    const result = assembleFacts(2025, [
      { id: "a", role: "full_return", taxYear: 2025, facts },
    ], { "k1s[12-3456789].w2WagesFromEntity": 85000 });

    expect(taxReturnFactsSchema.safeParse(result.facts).success).toBe(true);
    // Pins that the override actually LANDED, not just that the shape still
    // parses — a schema-satisfying result is necessary but not sufficient,
    // since w2WagesFromEntity: null also parses.
    expect(result.facts.k1s[0].w2WagesFromEntity).toBe(85000);
  });
});

describe("recomputeFacts", () => {
  it("throws MissingTaxReturnStateError rather than silently discarding advisor corrections when no state row exists", async () => {
    // getState() is mocked to null above, standing in for an un-backfilled
    // tax_return_state row. A `state?.factsOverrides ?? {}` rewrite would
    // swallow this case and recompute against an empty override map instead
    // of failing loudly — this test exists to pin the throw so that rewrite
    // cannot pass silently.
    await expect(
      recomputeFacts("11111111-1111-1111-1111-111111111111", 2025),
    ).rejects.toThrow(MissingTaxReturnStateError);
    expect(writes.count).toBe(0);
  });

  it("refuses to blank a return when the last document is removed and there are no overrides", async () => {
    // The destructive case this guard exists for. Every production tax return
    // today has `facts` byte-identical to `extracted_facts`, so the backfill
    // gives it ONE document and an EMPTY override map — deleting that document
    // leaves exactly this state, and merging zero documents yields
    // emptyTaxReturnFacts (every leaf null, both entity arrays empty). Without
    // the guard that all-null object is persisted over the client's filed
    // return, with no error.
    store.docs = [];
    store.state = { factsOverrides: {} };

    await expect(
      recomputeFacts("11111111-1111-1111-1111-111111111111", 2025),
    ).rejects.toThrow(EmptyRecomputeError);
    expect(writes.count).toBe(0);
  });

  it("still recomputes a manually-entered return, which legitimately has no document", async () => {
    // The negative half of the guard, and the reason it tests BOTH inputs
    // rather than just `docs.length === 0`. The backfill plans a hand-entered
    // row as document: null with the whole of its facts as overrides, so a
    // docs-only check would refuse every manual return and throw on a row that
    // is perfectly well-formed.
    store.docs = [];
    store.state = { factsOverrides: { "income.wages": 250000 } };

    const facts = await recomputeFacts("11111111-1111-1111-1111-111111111111", 2025);

    expect(facts.income.wages).toBe(250000);
    expect(writes.count).toBe(1);
  });

  it("refuses to persist facts that do not satisfy the schema", async () => {
    // `facts_overrides` is bare jsonb and applyOverrides type-checks nothing,
    // so a bad override value reaches the persisted column unchallenged. That
    // does not fail here — it fails on every subsequent READ, because
    // parseRowFacts re-validates the stored jsonb, blanking the client's whole
    // Tax Analysis tab permanently. This is the only place it can be caught.
    const facts = emptyTaxReturnFacts(2025);
    store.docs = [{ id: "a", role: "full_return", taxYear: 2025, facts }];
    store.state = { factsOverrides: { "income.wages": "250000" } };

    await expect(
      recomputeFacts("11111111-1111-1111-1111-111111111111", 2025),
    ).rejects.toThrow();
    expect(writes.count).toBe(0);
  });
});

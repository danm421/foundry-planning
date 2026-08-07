import { describe, it, expect, vi, beforeEach } from "vitest";
import { emptyK1, emptyTaxReturnFacts } from "@/lib/schemas/tax-return-facts";
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
      entityId: null,
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

  it("keeps an advisor's rename and their other edits across a recompute", async () => {
    // End to end through the layers that actually run in production: the
    // document stamps identity, the review form submits a corrected name, the
    // diff files the edits, and the NEXT recompute — same document, unchanged —
    // reproduces them. Keyed off the entity's own text, this loses both edits.
    const { diffOverrides } = await import("../merge/overrides");

    const extracted = emptyTaxReturnFacts(2025);
    extracted.k1s = [{
      ...emptyK1(),
      entityName: "RIDGE PARTNRS LLC", ein: null, entityType: "partnership",
      ordinaryBusinessIncome: 42000,
    }];
    const docs = [{ id: "a", role: "full_return" as const, taxYear: 2025, facts: extracted }];

    const shown = assembleFacts(2025, docs, {}).facts;
    const submitted = structuredClone(shown);
    submitted.k1s[0].entityName = "Ridge Partners LLC";
    submitted.k1s[0].w2WagesFromEntity = 85000;

    const overrides = diffOverrides(shown, submitted);
    const recomputed = assembleFacts(2025, docs, overrides).facts;

    expect(recomputed.k1s).toHaveLength(1);
    expect(recomputed.k1s[0].entityName).toBe("Ridge Partners LLC");
    expect(recomputed.k1s[0].w2WagesFromEntity).toBe(85000);
    // And a SECOND round trip is stable — the corrected name must not re-key
    // the entity now that it is the value the form submits from.
    const twice = assembleFacts(2025, docs, diffOverrides(shown, recomputed)).facts;
    expect(twice.k1s).toEqual(recomputed.k1s);
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

  it.each([
    ["a W-2, whose figures never reach `facts`", { id: "w", role: "w2" as const, taxYear: 2025, facts: null }],
    ["an `other`, which the merge skips outright", { id: "o", role: "other" as const, taxYear: 2025, facts: emptyTaxReturnFacts(2025) }],
    ["a document whose stored facts no longer parse", { id: "b", role: "full_return" as const, taxYear: 2025, facts: null }],
  ])("refuses to blank a return whose only remaining document is %s", async (_label, doc) => {
    // The guard must count CONTRIBUTING documents, not rows. This is the
    // ordinary multi-document flow, not a corner: upload a 1040 + a W-2, then
    // remove the 1040 to re-upload a corrected one. `docs.length === 1` so a
    // row-count guard waves it through, `mergeDocuments` contributes nothing
    // from a W-2/`other`/unparseable row, and the resulting all-null object is
    // a VALID TaxReturnFacts — so the schema re-parse passes and the year is
    // silently overwritten with blanks, returning 200 OK.
    store.docs = [doc];
    store.state = { factsOverrides: {} };

    await expect(
      recomputeFacts("11111111-1111-1111-1111-111111111111", 2025),
    ).rejects.toThrow(EmptyRecomputeError);
    expect(writes.count).toBe(0);
  });

  it("still recomputes when a non-contributing document sits alongside a contributing one", async () => {
    // The negative half: a W-2 next to the 1040 must not make the year
    // unrecomputable. A guard written as "every document contributes" rather
    // than "some document contributes" would refuse this — the normal case the
    // whole feature exists to support.
    const facts = emptyTaxReturnFacts(2025);
    facts.income.wages = 250000;
    store.docs = [
      { id: "w", role: "w2", taxYear: 2025, facts: null },
      { id: "a", role: "full_return", taxYear: 2025, facts },
    ];
    store.state = { factsOverrides: {} };

    const result = await recomputeFacts("11111111-1111-1111-1111-111111111111", 2025);

    expect(result.income.wages).toBe(250000);
    expect(writes.count).toBe(1);
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

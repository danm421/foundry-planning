import { describe, it, expect } from "vitest";
import {
  emptyTaxReturnFacts, emptyK1, emptyBusiness, emptyScheduleA,
} from "@/lib/schemas/tax-return-facts";
import {
  planBackfill, backfillReplayDifferences, differencesIncludeEntities,
} from "@/lib/tax-returns/backfill";
import { assembleFacts } from "@/lib/tax-returns/recompute";

describe("planBackfill", () => {
  it("turns an extracted row into one document plus the advisor's diff", () => {
    const extracted = emptyTaxReturnFacts(2025);
    extracted.income.agi = 412000;
    const facts = structuredClone(extracted);
    facts.income.agi = 418500;

    const plan = planBackfill({
      id: "row-1", taxYear: 2025, extractedFacts: extracted, facts,
      sourceFilename: "1040.pdf", vaultDocumentId: "vault-1",
      warnings: ["w"], promptVersion: "v1", model: "full",
    });

    expect(plan).not.toBeNull();
    expect(plan!.document).toMatchObject({
      role: "full_return", filename: "1040.pdf", taxYear: 2025,
    });
    expect(plan!.overrides).toEqual({ "income.agi": 418500 });
  });

  it("recompute over the plan reproduces the original facts exactly", () => {
    const extracted = emptyTaxReturnFacts(2025);
    extracted.income.wages = 250000;
    extracted.income.agi = 412000;
    const facts = structuredClone(extracted);
    facts.income.agi = 418500;
    facts.deductions.deductionTaken = "itemized";

    const plan = planBackfill({
      id: "row-1", taxYear: 2025, extractedFacts: extracted, facts,
      sourceFilename: null, vaultDocumentId: null,
      warnings: [], promptVersion: null, model: null,
    })!;

    const replayed = assembleFacts(2025, [
      { id: "doc-1", role: "full_return", taxYear: 2025, facts: extracted },
    ], plan.overrides);

    expect(replayed.facts).toEqual(facts);
  });

  it("gives a manually-entered row no document and all facts as overrides", () => {
    const facts = emptyTaxReturnFacts(2025);
    facts.income.wages = 100000;

    const plan = planBackfill({
      id: "row-2", taxYear: 2025, extractedFacts: null, facts,
      sourceFilename: "", vaultDocumentId: null,
      warnings: [], promptVersion: "manual", model: "manual",
    })!;

    expect(plan.document).toBeNull();
    const replayed = assembleFacts(2025, [], plan.overrides);
    expect(replayed.facts).toEqual(facts);
  });

  it("skips a row whose facts do not parse", () => {
    expect(planBackfill({
      id: "row-3", taxYear: 2025, extractedFacts: null, facts: { bogus: true },
      sourceFilename: null, vaultDocumentId: null,
      warnings: [], promptVersion: null, model: null,
    })).toBeNull();
  });
});

/**
 * The lossless-replay gate. `planBackfill` cannot itself guarantee the
 * property its docstring wants, because `diffOverrides` emits per-field
 * overrides for an entity that exists in `facts` but not in the base, while
 * `applyOverrides` deliberately REFUSES to create entities from overrides (a
 * stale override must never resurrect a deleted K-1). Diff emits it, replay
 * discards it. Without this gate the backfill would write a state row whose
 * first `recomputeFacts` silently deletes those K-1s and Schedule C
 * businesses from `tax_returns.facts`.
 *
 * The runner therefore SKIPS any row this rejects: no state row means
 * `recomputeFacts` throws `MissingTaxReturnStateError` loudly instead.
 *
 * These assert the RETURNED PATH, not just a verdict, because the path is what
 * the runner logs and what classifies a rejected row: `k1s` / `businesses` is
 * real loss needing an owner decision, anything else is the gate refusing
 * structurally where nothing would be lost. A test that only pinned
 * accept/reject would let the two collapse into one opaque bucket again.
 */
describe("backfillReplayDifferences", () => {
  const ridgeK1 = {
    ...emptyK1(),
    entityName: "Ridge Partners LLC", ein: "12-3456789",
    entityType: "partnership" as const, ordinaryBusinessIncome: 42000,
    guaranteedPayments: 30000, qbiIncome: 42000, isSstb: false,
  };

  it("accepts a scalar-only extracted row whose replay is exact", () => {
    const extracted = emptyTaxReturnFacts(2025);
    extracted.income.wages = 250000;
    extracted.income.agi = 412000;
    const facts = structuredClone(extracted);
    facts.income.agi = 418500;
    facts.deductions.deductionTaken = "itemized";

    const plan = planBackfill({
      id: "row-1", taxYear: 2025, extractedFacts: extracted, facts,
      sourceFilename: "1040.pdf", vaultDocumentId: null,
      warnings: [], promptVersion: null, model: null,
    })!;

    expect(backfillReplayDifferences(2025, plan, facts)).toEqual([]);
  });

  it("rejects a manually-entered row carrying a K-1, whose replay drops it", () => {
    const facts = emptyTaxReturnFacts(2025);
    facts.income.wages = 100000;
    facts.k1s = [ridgeK1];

    const plan = planBackfill({
      id: "row-2", taxYear: 2025, extractedFacts: null, facts,
      sourceFilename: null, vaultDocumentId: null,
      warnings: [], promptVersion: "manual", model: "manual",
    })!;

    // The diff DOES carry the K-1's fields...
    expect(plan.overrides).toHaveProperty("k1s[12-3456789].ordinaryBusinessIncome", 42000);
    // ...but the replay drops the whole entity, which is the loss this gate
    // exists to refuse.
    expect(assembleFacts(2025, [], plan.overrides).facts.k1s).toEqual([]);
    expect(backfillReplayDifferences(2025, plan, facts)).toEqual(["k1s"]);
  });

  it("rejects an extracted row where the advisor ADDED a K-1 the document lacks", () => {
    const extracted = emptyTaxReturnFacts(2025);
    extracted.income.wages = 250000;
    const facts = structuredClone(extracted);
    facts.k1s = [ridgeK1];

    const plan = planBackfill({
      id: "row-3", taxYear: 2025, extractedFacts: extracted, facts,
      sourceFilename: "1040.pdf", vaultDocumentId: null,
      warnings: [], promptVersion: null, model: null,
    })!;

    expect(plan.document).not.toBeNull();
    expect(assembleFacts(2025, [
      { id: "doc-1", role: "full_return", taxYear: 2025, facts: extracted },
    ], plan.overrides).facts.k1s).toEqual([]);
    expect(backfillReplayDifferences(2025, plan, facts)).toEqual(["k1s"]);
  });

  it("rejects an extracted row where the advisor DELETED an extracted K-1", () => {
    // The mirror image: `diffOverrides` only walks `submitted`, so a removal
    // emits nothing at all and the document resurrects the entity on replay.
    const extracted = emptyTaxReturnFacts(2025);
    extracted.k1s = [ridgeK1];
    const facts = structuredClone(extracted);
    facts.k1s = [];

    const plan = planBackfill({
      id: "row-4", taxYear: 2025, extractedFacts: extracted, facts,
      sourceFilename: "1040.pdf", vaultDocumentId: null,
      warnings: [], promptVersion: null, model: null,
    })!;

    expect(backfillReplayDifferences(2025, plan, facts)).toEqual(["k1s"]);
  });

  it("rejects a manually-entered row carrying a Schedule C business", () => {
    // `businesses` is the OTHER entity collection and it keys differently:
    // `entityKey` falls back to a normalized `name` because a Schedule C has
    // neither `ein` nor `entityName`. The k1s tests above all key on `ein`, so
    // without this one the whole name-keyed branch is uncovered.
    const facts = emptyTaxReturnFacts(2025);
    facts.businesses = [{
      ...emptyBusiness(), name: "Mueller Consulting", netProfit: 90000, isSstb: false,
    }];

    const plan = planBackfill({
      id: "row-5", taxYear: 2025, extractedFacts: null, facts,
      sourceFilename: null, vaultDocumentId: null,
      warnings: [], promptVersion: "manual", model: "manual",
    })!;

    // Pins the name-derived key, not just the verdict — dropping `entityKey`'s
    // `name` fallback would leave the row rejected for a DIFFERENT reason and
    // a verdict-only test would still pass.
    expect(plan.overrides).toHaveProperty("businesses[name:mueller consulting].netProfit", 90000);
    expect(assembleFacts(2025, [], plan.overrides).facts.businesses).toEqual([]);
    expect(backfillReplayDifferences(2025, plan, facts)).toEqual(["businesses"]);
  });

  it("rejects an extracted row whose facts.taxYear disagrees with the tax_year column", () => {
    // No document can write `taxYear` — it is in neither SCALAR_ROOTS nor
    // TOP_LEVEL_SCALARS — and here the diff is empty, so the replay yields the
    // COLUMN's year and the stored 2024 is unreachable.
    const extracted = emptyTaxReturnFacts(2024);
    extracted.income.wages = 100;
    const facts = structuredClone(extracted);

    const plan = planBackfill({
      id: "row-6", taxYear: 2025, extractedFacts: extracted, facts,
      sourceFilename: "1040.pdf", vaultDocumentId: null,
      warnings: [], promptVersion: null, model: null,
    })!;

    expect(plan.overrides).toEqual({});
    expect(backfillReplayDifferences(2025, plan, facts)).toEqual(["taxYear"]);
  });

  it("ACCEPTS the same taxYear disagreement on a manually-entered row", () => {
    // The documented asymmetry, pinned so the rejection above is not mistaken
    // for a universal rule. The manual base is `emptyTaxReturnFacts(column)`,
    // so `taxYear` differs from it and the diff emits it as an ordinary scalar
    // override — the replay then reproduces the disagreement faithfully. The
    // backfill preserves an existing inconsistency rather than introducing one.
    const facts = emptyTaxReturnFacts(2024);
    facts.income.wages = 100;

    const plan = planBackfill({
      id: "row-7", taxYear: 2025, extractedFacts: null, facts,
      sourceFilename: null, vaultDocumentId: null,
      warnings: [], promptVersion: "manual", model: "manual",
    })!;

    expect(plan.overrides).toHaveProperty("taxYear", 2024);
    expect(backfillReplayDifferences(2025, plan, facts)).toEqual([]);
  });

  it("rejects an all-null nullable block even though nothing would be lost", () => {
    // An extraction that MATERIALIZED `deductions.scheduleA` as an all-null
    // object instead of omitting it. `collectLeaves` returns early on every
    // null, so the merge leaves the block `null` and the diff has nothing to
    // say — yet `null` and an all-null block are the same thing to every
    // reader. This is the gate being conservative, not data loss, and it is
    // why the runner logs the path: `deductions.scheduleA` classifies very
    // differently from `k1s`. Pinned so the distinction cannot quietly vanish.
    const extracted = emptyTaxReturnFacts(2025);
    extracted.income.wages = 100;
    extracted.deductions.scheduleA = emptyScheduleA();
    const facts = structuredClone(extracted);

    const plan = planBackfill({
      id: "row-8", taxYear: 2025, extractedFacts: extracted, facts,
      sourceFilename: "1040.pdf", vaultDocumentId: null,
      warnings: [], promptVersion: null, model: null,
    })!;

    expect(plan.overrides).toEqual({});
    expect(backfillReplayDifferences(2025, plan, facts)).toEqual(["deductions.scheduleA"]);
    expect(differencesIncludeEntities(backfillReplayDifferences(2025, plan, facts))).toBe(false);
  });

  it("reports BOTH roots when a benign difference sits alongside a lost K-1", () => {
    // The masking case. `deductions` sorts before `k1s`, so reporting only the
    // sorted-FIRST difference would name `deductions.scheduleA` and nothing
    // else — and the runner would tell the operator this row lost nothing,
    // while it is in fact dropping a K-1. Three of the four benign nullable
    // blocks sort ahead of `k1s`, so this is the common shape, not a corner.
    const extracted = emptyTaxReturnFacts(2025);
    extracted.income.wages = 250000;
    extracted.deductions.scheduleA = emptyScheduleA(); // benign, sorts first
    const facts = structuredClone(extracted);
    facts.k1s = [ridgeK1];                             // real loss, sorts later

    const plan = planBackfill({
      id: "row-9", taxYear: 2025, extractedFacts: extracted, facts,
      sourceFilename: "1040.pdf", vaultDocumentId: null,
      warnings: [], promptVersion: null, model: null,
    })!;

    const paths = backfillReplayDifferences(2025, plan, facts);
    expect(paths).toEqual(["deductions.scheduleA", "k1s"]);
    // The classification the operator block promises must come out as loss.
    expect(differencesIncludeEntities(paths)).toBe(true);
  });
});

describe("differencesIncludeEntities", () => {
  it("matches an entity collection whether it differs whole or by field", () => {
    expect(differencesIncludeEntities(["k1s"])).toBe(true);
    expect(differencesIncludeEntities(["businesses"])).toBe(true);
    // Equal lengths, one field differing — `firstDifference` descends by index.
    expect(differencesIncludeEntities(["k1s[0].qbiIncome"])).toBe(true);
    expect(differencesIncludeEntities(["deductions.scheduleA", "businesses[1].netProfit"]))
      .toBe(true);
  });

  it("does not match the structural-only paths, including lookalikes", () => {
    expect(differencesIncludeEntities([])).toBe(false);
    expect(differencesIncludeEntities(["deductions.scheduleA", "taxYear"])).toBe(false);
    // A scalar leaf whose name merely STARTS with a collection name must not
    // be read as an entity difference — `startsWith(c)` alone would say true.
    expect(differencesIncludeEntities(["k1sSomething"])).toBe(false);
    expect(differencesIncludeEntities(["businessesTotal"])).toBe(false);
  });
});

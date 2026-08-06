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
 * The lossless-replay gate. `planBackfill` cannot itself guarantee the property
 * its docstring wants, so this is what decides whether a row may migrate: the
 * runner SKIPS any row it rejects, and a skipped row has no state row, so
 * `recomputeFacts` throws `MissingTaxReturnStateError` loudly instead of
 * rewriting `tax_returns.facts` with something lossy.
 *
 * These assert the RETURNED PATH, not just a verdict, because the path is what
 * the runner logs and what classifies a rejected row: `k1s` / `businesses` is
 * real loss needing an owner decision, anything else is the gate refusing
 * structurally where nothing would be lost. A test that only pinned
 * accept/reject would let the two collapse into one opaque bucket again.
 *
 * The entity cases below USED to be the gate's main population — an entity in
 * `facts` but not in the base was emitted by the diff and dropped by the
 * replay, and a deleted one emitted nothing so the document put it back. Stored
 * entity identity closed both, so they now assert the round trip. The gate
 * stays because it is what would catch a regression of either.
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

  it("migrates a manually-entered row carrying a K-1, under an advisor key", () => {
    const facts = emptyTaxReturnFacts(2025);
    facts.income.wages = 100000;
    facts.k1s = [ridgeK1];

    const plan = planBackfill({
      id: "row-2", taxYear: 2025, extractedFacts: null, facts,
      sourceFilename: null, vaultDocumentId: null,
      warnings: [], promptVersion: "manual", model: "manual",
    })!;

    // No document contributes it, so the entity exists ONLY as overrides — and
    // only an `adv:` key may create one. Pins the key SHAPE, not just the
    // verdict: a document-derived key here would replay to nothing.
    const k1Paths = Object.keys(plan.overrides).filter((p) => p.startsWith("k1s["));
    expect(k1Paths.length).toBeGreaterThan(0);
    expect(k1Paths.every((p) => /^k1s\[adv:[0-9a-f-]{36}\]\./.test(p))).toBe(true);

    const replayed = assembleFacts(2025, [], plan.overrides).facts;
    expect(replayed.k1s).toHaveLength(1);
    expect(replayed.k1s[0].ordinaryBusinessIncome).toBe(42000);
    expect(backfillReplayDifferences(2025, plan, facts)).toEqual([]);
  });

  it("migrates an extracted row where the advisor ADDED a K-1 the document lacks", () => {
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
    ], plan.overrides).facts.k1s).toHaveLength(1);
    expect(backfillReplayDifferences(2025, plan, facts)).toEqual([]);
  });

  it("migrates an extracted row where the advisor DELETED an extracted K-1", () => {
    // The mirror image, and the one that needs a marker rather than an absence:
    // the document still contains the K-1, so without an explicit deletion the
    // replay puts it straight back.
    const extracted = emptyTaxReturnFacts(2025);
    extracted.k1s = [ridgeK1];
    const facts = structuredClone(extracted);
    facts.k1s = [];

    const plan = planBackfill({
      id: "row-4", taxYear: 2025, extractedFacts: extracted, facts,
      sourceFilename: "1040.pdf", vaultDocumentId: null,
      warnings: [], promptVersion: null, model: null,
    })!;

    expect(plan.overrides).toHaveProperty("k1s[12-3456789].__deleted", true);
    expect(assembleFacts(2025, [
      { id: "doc-1", role: "full_return", taxYear: 2025, facts: extracted },
    ], plan.overrides).facts.k1s).toEqual([]);
    expect(backfillReplayDifferences(2025, plan, facts)).toEqual([]);
  });

  it("migrates a manually-entered row carrying a Schedule C business", () => {
    // `businesses` is the OTHER entity collection and it keys differently:
    // `derivedEntityKey` falls back to a normalized `name` because a Schedule C
    // has neither `ein` nor `entityName`. The k1s tests above all key on `ein`,
    // so without this one the whole name-keyed branch is uncovered.
    const facts = emptyTaxReturnFacts(2025);
    facts.businesses = [{
      ...emptyBusiness(), name: "Mueller Consulting", netProfit: 90000, isSstb: false,
    }];

    const plan = planBackfill({
      id: "row-5", taxYear: 2025, extractedFacts: null, facts,
      sourceFilename: null, vaultDocumentId: null,
      warnings: [], promptVersion: "manual", model: "manual",
    })!;

    const replayed = assembleFacts(2025, [], plan.overrides).facts;
    expect(replayed.businesses).toHaveLength(1);
    expect(replayed.businesses[0].name).toBe("Mueller Consulting");
    expect(replayed.businesses[0].netProfit).toBe(90000);
    expect(backfillReplayDifferences(2025, plan, facts)).toEqual([]);
  });

  it("still REJECTS a row whose entity the replay would genuinely drop", () => {
    // The gate's remaining job. An override keyed to a document-derived entity
    // that no document supplies can never create it — Task 7's rule, kept — so
    // a plan carrying one is lossy and the row must not migrate. Constructed
    // directly rather than via `planBackfill`, because the diff no longer emits
    // this shape; the point is that the GATE still catches it if anything does.
    const facts = emptyTaxReturnFacts(2025);
    facts.k1s = [ridgeK1];

    const paths = backfillReplayDifferences(2025, {
      taxReturnId: "row-7",
      document: null,
      overrides: { "k1s[12-3456789].ordinaryBusinessIncome": 42000 },
    }, facts);

    expect(paths).toEqual(["k1s"]);
    expect(differencesIncludeEntities(paths)).toBe(true);
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

    // Hand-built. `planBackfill` no longer emits a lossy entity override, so
    // the masking hazard is reproduced with the shape that still IS lossy: an
    // override keyed to a document-derived entity nothing supplies, which
    // `applyOverrides` refuses to create.
    const paths = backfillReplayDifferences(2025, {
      taxReturnId: "row-9",
      document: {
        role: "full_return", filename: "1040.pdf", vaultDocumentId: null,
        extractedFacts: extracted, warnings: [], promptVersion: null,
        model: null, taxYear: 2025,
      },
      overrides: { "k1s[12-3456789].ordinaryBusinessIncome": 42000 },
    }, facts);
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

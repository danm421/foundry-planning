import { describe, it, expect } from "vitest";
import { emptyTaxReturnFacts, emptyK1 } from "@/lib/schemas/tax-return-facts";
import { planBackfill, backfillPlanReplaysFacts } from "@/lib/tax-returns/backfill";
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
 */
describe("backfillPlanReplaysFacts", () => {
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

    expect(backfillPlanReplaysFacts(2025, plan, facts)).toBe(true);
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
    expect(backfillPlanReplaysFacts(2025, plan, facts)).toBe(false);
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
    expect(backfillPlanReplaysFacts(2025, plan, facts)).toBe(false);
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

    expect(backfillPlanReplaysFacts(2025, plan, facts)).toBe(false);
  });
});

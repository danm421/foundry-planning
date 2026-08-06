import { describe, it, expect } from "vitest";
import {
  emptyK1, emptyTaxReturnFacts, taxReturnFactsSchema, type K1Facts,
} from "@/lib/schemas/tax-return-facts";
import { applyOverrides, diffOverrides } from "../overrides";
import { deriveProvenance } from "../provenance";

describe("applyOverrides", () => {
  it("applies a scalar override", () => {
    const base = emptyTaxReturnFacts(2025);
    base.income.wages = 250000;
    const out = applyOverrides(base, { "income.wages": 252000 });
    expect(out.income.wages).toBe(252000);
  });

  it("does not mutate the input", () => {
    const base = emptyTaxReturnFacts(2025);
    base.income.wages = 250000;
    applyOverrides(base, { "income.wages": 252000 });
    expect(base.income.wages).toBe(250000);
  });

  it("creates a nullable block when overriding into it", () => {
    const base = emptyTaxReturnFacts(2025);
    expect(base.deductions.qbi).toBeNull();
    const out = applyOverrides(base, { "deductions.qbi.w2Wages": 60000 });
    expect(out.deductions.qbi?.w2Wages).toBe(60000);
    // The materialized block must satisfy every OTHER required key too — a
    // factory that omitted one would pass the assertion above yet fail the
    // strict schema, exactly the class of bug Task 5's `setLeaf` shipped.
    expect(taxReturnFactsSchema.safeParse(out).success).toBe(true);
  });

  it("creates the income.scheduleE nullable block when overriding into it", () => {
    const base = emptyTaxReturnFacts(2025);
    expect(base.income.scheduleE).toBeNull();
    const out = applyOverrides(base, { "income.scheduleE.grossRents": 19600 });
    expect(out.income.scheduleE?.grossRents).toBe(19600);
    // `income.scheduleE` is the block with the live `.default(null)`
    // production trap: parseRowFacts re-validates persisted jsonb through
    // this exact schema on every read.
    expect(taxReturnFactsSchema.safeParse(out).success).toBe(true);
  });

  it("ignores an override into an unknown intermediate block rather than growing the object", () => {
    const base = emptyTaxReturnFacts(2025);
    const out = applyOverrides(base, { "income.bogusBlock.field": 1 });
    expect((out.income as Record<string, unknown>).bogusBlock).toBeUndefined();
  });

  it("applies an entity override by merge key, not index", () => {
    const base = emptyTaxReturnFacts(2025);
    base.k1s = [
      { entityId: null, entityName: "Summit Holdings Inc", ein: "98-7654321", entityType: "s_corp",
        ordinaryBusinessIncome: 120000, rentalIncome: null, guaranteedPayments: null,
        section179: null, w2WagesFromEntity: null, qbiIncome: 120000, isSstb: false },
      { entityId: null, entityName: "Ridge Partners LLC", ein: "12-3456789", entityType: "partnership",
        ordinaryBusinessIncome: 42000, rentalIncome: null, guaranteedPayments: 30000,
        section179: null, w2WagesFromEntity: null, qbiIncome: 42000, isSstb: false },
    ];

    // Target the SECOND entity (index 1), not index 0 — a positional
    // implementation (`list[0]`) must fail this, not just happen to pass.
    const out = applyOverrides(base, { "k1s[12-3456789].w2WagesFromEntity": 85000 });

    expect(out.k1s.find((k) => k.ein === "12-3456789")?.w2WagesFromEntity).toBe(85000);
    expect(out.k1s.find((k) => k.ein === "98-7654321")?.w2WagesFromEntity).toBeNull();
  });

  it("ignores an entity override whose key is no longer present", () => {
    const base = emptyTaxReturnFacts(2025);
    const out = applyOverrides(base, { "k1s[99-9999999].w2WagesFromEntity": 85000 });
    expect(out.k1s).toHaveLength(0);
  });

  it("ignores an unknown scalar path rather than growing the object", () => {
    const base = emptyTaxReturnFacts(2025);
    const out = applyOverrides(base, { "income.bogusField": 1 });
    expect((out.income as Record<string, unknown>).bogusField).toBeUndefined();
  });
});

describe("diffOverrides", () => {
  it("captures only the fields the advisor changed", () => {
    const base = emptyTaxReturnFacts(2025);
    base.income.wages = 250000;
    base.income.agi = 412000;

    const submitted = structuredClone(base);
    submitted.income.agi = 418500;

    expect(diffOverrides(base, submitted)).toEqual({ "income.agi": 418500 });
  });

  it("captures a cleared field as an explicit null", () => {
    const base = emptyTaxReturnFacts(2025);
    base.income.wages = 250000;
    const submitted = structuredClone(base);
    submitted.income.wages = null;

    expect(diffOverrides(base, submitted)).toEqual({ "income.wages": null });
  });

  it("round-trips through applyOverrides", () => {
    const base = emptyTaxReturnFacts(2025);
    base.income.wages = 250000;
    const submitted = structuredClone(base);
    submitted.income.wages = 251000;
    submitted.deductions.deductionTaken = "itemized";

    expect(applyOverrides(base, diffOverrides(base, submitted))).toEqual(submitted);
  });

  it("diffs entity fields by merge key", () => {
    const base = emptyTaxReturnFacts(2025);
    base.k1s = [{
      entityId: null, entityName: "Ridge Partners LLC", ein: "12-3456789", entityType: "partnership",
      ordinaryBusinessIncome: 42000, rentalIncome: null, guaranteedPayments: 30000,
      section179: null, w2WagesFromEntity: null, qbiIncome: 42000, isSstb: false,
    }];
    const submitted = structuredClone(base);
    submitted.k1s[0].w2WagesFromEntity = 85000;

    expect(diffOverrides(base, submitted))
      .toEqual({ "k1s[12-3456789].w2WagesFromEntity": 85000 });
  });
});

/**
 * The four directions entity identity had to close. Each `it` below names one
 * and fails without a STORED id: re-deriving the key from the entity's own OCR
 * text cannot survive an advisor editing that text, and cannot address an
 * entity whose text is missing entirely.
 */
describe("entity identity — advisor edits survive", () => {
  const stamped = (over: Partial<K1Facts> = {}): K1Facts => ({
    ...emptyK1(),
    entityId: "12-3456789", entityName: "RIDGE PARTNRS LLC", ein: "12-3456789",
    entityType: "partnership", ordinaryBusinessIncome: 42000, qbiIncome: 42000,
    ...over,
  });

  it("RENAME: correcting a garbled name keeps the rename AND the edits beside it", () => {
    // The canonical review-form edit. Keyed off the entity's own name, the
    // corrected name produced a DIFFERENT key, so both this rename and the
    // w2WagesFromEntity beside it were filed under a key nothing matched and
    // silently dropped on the next recompute.
    const base = emptyTaxReturnFacts(2025);
    base.k1s = [stamped()];

    const submitted = structuredClone(base);
    submitted.k1s[0].entityName = "Ridge Partners LLC";
    submitted.k1s[0].w2WagesFromEntity = 85000;

    const overrides = diffOverrides(base, submitted);
    expect(overrides).toEqual({
      "k1s[12-3456789].entityName": "Ridge Partners LLC",
      "k1s[12-3456789].w2WagesFromEntity": 85000,
    });
    expect(applyOverrides(base, overrides)).toEqual(submitted);
  });

  it("RENAME survives when the name IS the key — the id, not the name, is matched", () => {
    // The harder half: with no EIN the stored id is `name:<the old name>`, so a
    // rename changes the derived key out from under itself.
    const base = emptyTaxReturnFacts(2025);
    base.k1s = [stamped({ ein: null, entityId: "name:ridge partnrs llc" })];

    const submitted = structuredClone(base);
    submitted.k1s[0].entityName = "Ridge Partners LLC";

    const overrides = diffOverrides(base, submitted);
    expect(overrides).toEqual({
      "k1s[name:ridge partnrs llc].entityName": "Ridge Partners LLC",
    });
    expect(applyOverrides(base, overrides).k1s[0].entityName).toBe("Ridge Partners LLC");
  });

  it("UNADDRESSABLE: an entity with no EIN and no name is still editable", () => {
    const base = emptyTaxReturnFacts(2025);
    base.k1s = [stamped({ ein: null, entityName: null, entityId: "doc:abc-123:0" })];

    const submitted = structuredClone(base);
    submitted.k1s[0].entityName = "Ridge Partners LLC";

    const overrides = diffOverrides(base, submitted);
    expect(overrides).toEqual({
      "k1s[doc:abc-123:0].entityName": "Ridge Partners LLC",
    });
    expect(applyOverrides(base, overrides).k1s[0].entityName).toBe("Ridge Partners LLC");
  });

  it("DELETE: removing an entity emits a deletion that survives recompute", () => {
    const base = emptyTaxReturnFacts(2025);
    base.k1s = [stamped(), stamped({ entityId: "98-7654321", ein: "98-7654321" })];

    const submitted = structuredClone(base);
    submitted.k1s = [submitted.k1s[1]];

    const overrides = diffOverrides(base, submitted);
    expect(overrides).toEqual({ "k1s[12-3456789].__deleted": true });
    // Without this the document puts the entity straight back on every recompute.
    expect(applyOverrides(base, overrides).k1s.map((k) => k.entityId)).toEqual(["98-7654321"]);
  });

  it("CREATE: an advisor-added entity persists, under a key no document can mint", () => {
    const base = emptyTaxReturnFacts(2025);
    const submitted = structuredClone(base);
    submitted.k1s = [{ ...emptyK1(), entityName: "Ridge Partners LLC", qbiIncome: 42000 }];

    const overrides = diffOverrides(base, submitted);
    const keys = Object.keys(overrides);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((k) => /^k1s\[adv:[0-9a-f-]{36}\]\./.test(k))).toBe(true);

    const out = applyOverrides(base, overrides);
    expect(out.k1s).toHaveLength(1);
    expect(out.k1s[0].entityName).toBe("Ridge Partners LLC");
    expect(out.k1s[0].qbiIncome).toBe(42000);
    // The created entity is fully-shaped, not a sparse object that would fail
    // the strict schema on the next read.
    expect(taxReturnFactsSchema.safeParse(out).success).toBe(true);
  });

  it("CREATE is idempotent — re-saving the created entity does not duplicate it", () => {
    const base = emptyTaxReturnFacts(2025);
    const first = structuredClone(base);
    first.k1s = [{ ...emptyK1(), entityName: "Ridge Partners LLC" }];

    // Round 1: create. Round 2 starts from what the advisor was SHOWN, which
    // carries the minted id — so the second save must match, not re-mint.
    const shown = applyOverrides(base, diffOverrides(base, first));
    const second = structuredClone(shown);
    second.k1s[0].qbiIncome = 42000;

    const overrides = diffOverrides(base, second);
    const advKeys = new Set(
      Object.keys(overrides).map((p) => p.replace(/^k1s\[(.+)\]\..+$/, "$1")),
    );
    expect(advKeys.size).toBe(1);
    expect(advKeys.has(shown.k1s[0].entityId!)).toBe(true);
    expect(applyOverrides(base, overrides).k1s).toHaveLength(1);
  });

  it("deleting an advisor-created entity simply drops its overrides", () => {
    const base = emptyTaxReturnFacts(2025);
    const created = structuredClone(base);
    created.k1s = [{ ...emptyK1(), entityName: "Ridge Partners LLC" }];
    const shown = applyOverrides(base, diffOverrides(base, created));

    expect(shown.k1s).toHaveLength(1);

    // No `__deleted` marker is needed or emitted: the entity exists ONLY as
    // overrides, and the base the diff runs against never had it — so omitting
    // it from the submitted facts IS the deletion.
    const afterDelete = structuredClone(shown);
    afterDelete.k1s = [];

    const overrides = diffOverrides(base, afterDelete);
    expect(overrides).toEqual({});
    expect(applyOverrides(base, overrides).k1s).toHaveLength(0);
  });

  it("a deletion outranks a field edit on the same entity, whatever the key order", () => {
    // `facts_overrides` is jsonb; its enumeration order is not ours to choose.
    const base = emptyTaxReturnFacts(2025);
    base.k1s = [stamped()];

    const deleteFirst = { "k1s[12-3456789].__deleted": true, "k1s[12-3456789].qbiIncome": 1 };
    const editFirst = { "k1s[12-3456789].qbiIncome": 1, "k1s[12-3456789].__deleted": true };

    expect(applyOverrides(base, deleteFirst).k1s).toHaveLength(0);
    expect(applyOverrides(base, editFirst).k1s).toHaveLength(0);
  });

  it("a stale deletion for an entity no document produces is inert", () => {
    // The mirror of the ignore-unknown-key rule: a deletion can never outlive
    // the thing it deletes, so removing the document also retires its deletion.
    const base = emptyTaxReturnFacts(2025);
    base.k1s = [stamped()];
    const out = applyOverrides(base, { "k1s[99-9999999].__deleted": true });
    expect(out.k1s).toHaveLength(1);
  });

  it("still refuses to create an entity under a DOCUMENT key", () => {
    // Task 7's rule, kept: only an `adv:` key may create. A stale override left
    // by a removed document must not resurrect the entity it described.
    const base = emptyTaxReturnFacts(2025);
    const out = applyOverrides(base, {
      "k1s[12-3456789].qbiIncome": 42000,
      "k1s[name:ridge partners llc].qbiIncome": 42000,
      "k1s[doc:abc-123:0].qbiIncome": 42000,
    });
    expect(out.k1s).toHaveLength(0);
  });
});

describe("deriveProvenance", () => {
  it("marks overridden paths as advisor-sourced", () => {
    const merged = { "income.wages": "doc-a", "income.agi": "doc-a" };
    const out = deriveProvenance(merged, { "income.agi": 418500 });
    expect(out["income.wages"]).toBe("doc-a");
    expect(out["income.agi"]).toBe("advisor");
  });

  it("marks an advisor-only path as advisor-sourced", () => {
    const out = deriveProvenance({}, { "income.wages": 1 });
    expect(out["income.wages"]).toBe("advisor");
  });
});

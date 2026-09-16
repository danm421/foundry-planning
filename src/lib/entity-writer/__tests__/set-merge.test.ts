// src/lib/entity-writer/__tests__/set-merge.test.ts
import { describe, it, expect } from "vitest";
import { DETAIL_ENTITIES, findEntity } from "@/domain/forge/detail-fields";
import { mergeIntoSet, SET_REPLACING_ENTITY_IDS } from "../set-merge";

const beneficiary = findEntity("life_insurance_policy_beneficiary")!;

describe("SET_REPLACING_ENTITY_IDS", () => {
  it("lists exactly the entities whose payload is a bare array", () => {
    const fromMap = DETAIL_ENTITIES.filter((e) => e.payloadShape === "array").map((e) => e.id).sort();
    expect([...SET_REPLACING_ENTITY_IDS].sort()).toEqual(fromMap);
  });

  it("includes every beneficiary designation, which is the dangerous case", () => {
    expect(SET_REPLACING_ENTITY_IDS).toContain("life_insurance_policy_beneficiary");
    expect(SET_REPLACING_ENTITY_IDS).toContain("account_beneficiary_designation");
    expect(SET_REPLACING_ENTITY_IDS).toContain("trust_beneficiary_designation");
  });
});

describe("mergeIntoSet", () => {
  it("keeps every existing row and appends the new one", () => {
    const result = mergeIntoSet({
      entity: beneficiary,
      existing: [{ recipientKind: "family", recipientId: "a", percent: 100 }],
      incoming: { recipientKind: "family", recipientId: "b", percent: 50 },
    });
    expect(result.rows).toHaveLength(2);
    expect(result.replaced).toBeNull();
  });

  it("never returns fewer rows than it was given", () => {
    const existing = [{ recipientId: "a" }, { recipientId: "b" }, { recipientId: "c" }];
    const result = mergeIntoSet({ entity: beneficiary, existing, incoming: { recipientId: "d" } });
    expect(result.rows.length).toBeGreaterThanOrEqual(existing.length);
  });

  it("replaces in place when the identity matches an existing row", () => {
    const withIdentity = { ...beneficiary, identity: ["recipientId"] as const };
    const result = mergeIntoSet({
      entity: withIdentity,
      existing: [{ recipientId: "a", percent: 100 }, { recipientId: "b", percent: 0 }],
      incoming: { recipientId: "b", percent: 50 },
    });
    expect(result.rows).toHaveLength(2);
    expect(result.replaced).toBe(1);
    expect(result.rows[1]).toEqual({ recipientId: "b", percent: 50 });
  });

  it("appends when the entity declares no identity", () => {
    const result = mergeIntoSet({
      entity: beneficiary,
      existing: [{ recipientId: "a" }],
      incoming: { recipientId: "a" },
    });
    expect(result.rows).toHaveLength(2);
  });

  it("handles an empty existing set", () => {
    const result = mergeIntoSet({ entity: beneficiary, existing: [], incoming: { recipientId: "a" } });
    expect(result.rows).toEqual([{ recipientId: "a" }]);
    expect(result.replaced).toBeNull();
  });

  it("does not mutate the array it was given", () => {
    const existing = [{ recipientId: "a" }];
    mergeIntoSet({ entity: beneficiary, existing, incoming: { recipientId: "b" } });
    expect(existing).toHaveLength(1);
  });
});

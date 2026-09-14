// src/lib/entity-writer/__tests__/build-request.test.ts
import { describe, it, expect } from "vitest";
import { findEntity } from "@/domain/forge/detail-fields";
import { buildWriteRequest } from "../build-request";
import type { CandidateRow } from "@/lib/entity-extraction/types";

const life = findEntity("life_insurance_policy")!;

function row(values: Record<string, unknown>, overrides: Partial<CandidateRow> = {}): CandidateRow {
  return {
    entityId: life.id,
    rowId: "r1",
    values: Object.entries(values).map(([key, value]) => ({ key, value, snippet: "x", confidence: 0.9 })),
    missingRequired: [],
    rowConfidence: 0.9,
    ...overrides,
  };
}

describe("buildWriteRequest", () => {
  it("POSTs the entity's create route with a plain object body", () => {
    const result = buildWriteRequest({ entity: life, row: row({ name: "Term 20", faceValue: 500000 }) });
    expect(result).toMatchObject({
      ok: true,
      method: "POST",
      path: "/insurance-policies",
      body: { name: "Term 20", faceValue: 500000 },
    });
  });

  it("refuses a row that is missing a required field", () => {
    const result = buildWriteRequest({
      entity: life,
      row: row({ name: "Term 20" }, { missingRequired: ["faceValue", "ownerRef"] }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/faceValue/);
  });

  it("refuses a row carrying a flagged value rather than writing it", () => {
    const result = buildWriteRequest({
      entity: life,
      row: {
        ...row({}),
        values: [{ key: "policyType", value: "Universal Life", snippet: "x", confidence: 0.9, issue: "enum" }],
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/policyType/);
  });

  it("drops an update-only field on create and says so, rather than silently", () => {
    const entity = {
      ...life,
      fields: [
        { key: "name", label: "Name", kind: "string" as const, required: true },
        { key: "notes", label: "Notes", kind: "text" as const, appliesTo: "update" as const },
      ],
    };
    const result = buildWriteRequest({ entity, row: row({ name: "A", notes: "hi" }) });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body).toEqual({ name: "A" });
      expect(result.warnings.join(" ")).toMatch(/notes/);
    }
  });

  it("wraps the row under the declared key for a wrapped payload", () => {
    const entity = {
      ...life,
      payloadShape: { wrappedIn: "allocations" } as const,
      fields: [{ key: "assetClass", label: "Asset class", kind: "string" as const }],
    };
    const result = buildWriteRequest({ entity, row: row({ assetClass: "equity" }) });
    if (result.ok) expect(result.body).toEqual({ allocations: [{ assetClass: "equity" }] });
  });

  it("refuses a bare-array entity when the existing set was not supplied", () => {
    const entity = {
      ...life,
      payloadShape: "array" as const,
      fields: [{ key: "beneficiary", label: "Beneficiary", kind: "string" as const }],
    };
    const result = buildWriteRequest({ entity, row: row({ beneficiary: "Jane" }) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/replaces the whole set/i);
  });

  it("PUTs the merged set for a bare-array entity when the existing set is supplied", () => {
    const entity = {
      ...life,
      payloadShape: "array" as const,
      routes: { ...life.routes, update: "/insurance-policies/[policyId]/beneficiaries" },
      fields: [{ key: "beneficiary", label: "Beneficiary", kind: "string" as const }],
    };
    const result = buildWriteRequest({
      entity,
      row: row({ beneficiary: "Jane" }),
      existingSet: [{ beneficiary: "John" }],
    });
    expect(result).toMatchObject({ ok: true, method: "PUT" });
    if (result.ok) expect(result.body).toEqual([{ beneficiary: "John" }, { beneficiary: "Jane" }]);
  });

  it("refuses a nested entity and names the parent to write instead", () => {
    const entity = {
      ...life,
      routes: {},
      nestedIn: { entity: "will", key: "bequests" } as const,
      fields: [{ key: "percentage", label: "Percentage", kind: "percent" as const }],
    };
    const result = buildWriteRequest({ entity, row: row({ percentage: 50 }) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/will/);
  });

  it("refuses an entity with no create route", () => {
    const annuity = findEntity("annuity_contract")!;
    const result = buildWriteRequest({
      entity: annuity,
      row: { ...row({ carrier: "Athene" }), entityId: annuity.id },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no create route/i);
  });
});

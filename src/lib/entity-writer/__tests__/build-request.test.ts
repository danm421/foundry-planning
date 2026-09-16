// src/lib/entity-writer/__tests__/build-request.test.ts
import { describe, it, expect } from "vitest";
import { findEntity, findEntity as find, type DetailEntity } from "@/domain/forge/detail-fields";
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

/**
 * A term life policy the route's own `insurancePolicyCreateSchema` accepts.
 * Every key here is a real map field; drop any one and the schema refuses.
 */
const VALID_TERM_POLICY = {
  name: "Term 20",
  policyType: "term",
  insuredPerson: "client",
  ownerRef: { kind: "joint" },
  faceValue: 500000,
  termIssueYear: 2020,
  termLengthYears: 20,
};

describe("buildWriteRequest", () => {
  it("POSTs the entity's create route with a plain object body", () => {
    const result = buildWriteRequest({ entity: life, row: row(VALID_TERM_POLICY) });
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
      // `fields` is replaced wholesale, so life's own create schema no longer
      // describes this entity — carrying it over would refuse the fixture on
      // keys it deliberately does not have (I4).
      createSchema: undefined,
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
    // Deferred #7, MUST-FIX: without this line an `{ ok: false }` result made
    // the whole test execute ZERO assertions and still pass.
    expect(result.ok).toBe(true);
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

  it("refuses a bare-array entity when the existing set is not an array", () => {
    const entity = {
      ...life,
      payloadShape: "array" as const,
      fields: [{ key: "beneficiary", label: "Beneficiary", kind: "string" as const }],
    };
    const result = buildWriteRequest({
      entity,
      row: row({ beneficiary: "Jane" }),
      // Simulates a JSON payload that came back shaped as an object rather
      // than the array this entity requires — must refuse, not throw.
      existingSet: {} as unknown as unknown[],
    });
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
    // Deferred #7, MUST-FIX: the guarded body assertion needs its own
    // `ok === true` claim, not one folded into a `toMatchObject`.
    expect(result.ok).toBe(true);
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

/**
 * Final review I4 / Ruling 36. Spec Layer 5: "`createSchema` — 35 entities
 * have one; it is validated against before the request is sent." It never was,
 * so a row with all five map-`required` fields filled passed every local check
 * and 400'd at the route on a rule only the schema knows.
 *
 * NOT solved here, by ruling: `ownerRef`'s family/entity/external variants
 * demand a real database UUID a model reading a PDF cannot produce, so only
 * `{ kind: "joint" }` can ever succeed. That is a product limitation, filed
 * rather than fixed.
 */
describe("buildWriteRequest against the route's own create schema", () => {
  it("refuses a term policy with no term issue year, in the schema's own words", () => {
    // I4 Scenario A, the common case: all five map-`required` fields present,
    // `missingRequired` empty — and `validateTermFields` 400s at the route.
    const noIssueYear: Record<string, unknown> = { ...VALID_TERM_POLICY };
    delete noIssueYear.termIssueYear;
    const result = buildWriteRequest({ entity: life, row: row(noIssueYear) });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Term policies need a term issue year/);
      // Named by the on-screen label, not the payload key.
      expect(result.error).toMatch(/Term issue year/);
    }
  });

  it("refuses a term policy that sets both a term length and end-at-retirement", () => {
    // A cross-field rule NO amount of per-field required-ness can catch — the
    // proof that this is the schema talking and not a second copy of the map.
    const result = buildWriteRequest({
      entity: life,
      row: row({ ...VALID_TERM_POLICY, endsAtInsuredRetirement: true }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not both/i);
  });

  it("accepts a term policy the create schema is satisfied by", () => {
    // The other half: this must not become a blanket refusal.
    const result = buildWriteRequest({ entity: life, row: row(VALID_TERM_POLICY) });
    expect(result.ok).toBe(true);
  });

  it("refuses a disability policy whose insured is not one the route accepts", () => {
    // A second entity, so the wiring is not a life-insurance special case.
    const disability = findEntity("disability_policy")!;
    const result = buildWriteRequest({
      entity: disability,
      row: { ...row({ name: "Group LTD", insured: "child" }), entityId: disability.id },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Who is covered: .*expected one of/i);
  });
});

describe("buildWriteRequest on a set-replacing entity", () => {
  const beneficiaryEntity = {
    ...find("life_insurance_policy_beneficiary")!,
    identity: ["recipientId"] as const,
    routes: { update: "/insurance-policies/p1/beneficiaries" },
    // The real entity's fields (tier, percentage, familyMemberId, ...) don't
    // include recipientId/percent; override so the shared payload-building
    // step (which drops any row value not in `fields`) doesn't strip the
    // values this test's row and existingSet use.
    fields: [
      { key: "recipientId", label: "Recipient", kind: "string" as const },
      { key: "percent", label: "Percent", kind: "percent" as const },
    ],
  };

  it("supersedes the matching row in place instead of duplicating it", () => {
    const result = buildWriteRequest({
      entity: beneficiaryEntity,
      row: {
        entityId: beneficiaryEntity.id,
        rowId: "r1",
        values: [
          { key: "recipientId", value: "b", snippet: "x", confidence: 0.9 },
          { key: "percent", value: 50, snippet: "x", confidence: 0.9 },
        ],
        missingRequired: [],
        rowConfidence: 0.9,
      },
      existingSet: [{ recipientId: "a", percent: 100 }, { recipientId: "b", percent: 0 }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body).toHaveLength(2);
      expect(result.body).toContainEqual({ recipientId: "a", percent: 100 });
      expect(result.body).toContainEqual({ recipientId: "b", percent: 50 });
    }
  });
});

/**
 * Task 2 (Phase 3A). The pipeline could only ever CREATE, so a row matching a
 * record that already exists had nowhere to go. The update leg is opted into
 * per entity by `updateSemantics` on the map, never inferred: an entity whose
 * partial-update semantics nobody has read keeps Ruling 34's refusal.
 */
describe("update leg", () => {
  const base = {
    id: "family_member",
    label: "Family member",
    tab: "profile",
    surface: "test",
    table: "familyMembers",
    routes: { create: "/family-members", update: "/family-members/[memberId]" },
    scenarioScoped: false,
    fields: [
      { key: "firstName", label: "First Name", kind: "string", required: true },
      { key: "dateOfBirth", label: "Date of Birth", kind: "date" },
      { key: "claimedAsDependent", label: "Dependent", kind: "enum", enumValues: ["auto", "yes", "no"], appliesTo: "update" },
      { key: "role", label: "Household role", kind: "enum", enumValues: ["child"], writable: false },
    ],
  } as unknown as DetailEntity;

  const row = {
    entityId: "family_member",
    rowId: "f:family_member:0",
    missingRequired: [],
    rowConfidence: 0.9,
    match: { kind: "exact", existingId: "fm-7" },
    values: [
      { key: "firstName", value: "Emma", snippet: "Emma", confidence: 0.9 },
      { key: "dateOfBirth", value: "2011-03-14", snippet: "3/14/2011", confidence: 0.9 },
      { key: "claimedAsDependent", value: "yes", snippet: "dependent", confidence: 0.9 },
      { key: "role", value: "child", snippet: "child", confidence: 0.9 },
    ],
  } as unknown as CandidateRow;

  it("refuses an exact match when the entity has not opted in", () => {
    const result = buildWriteRequest({ entity: base, row });
    expect(result.ok).toBe(false);
  });

  it("builds a PUT with the existing id substituted when opted in", () => {
    const entity = { ...base, updateSemantics: { method: "PUT" } } as unknown as DetailEntity;
    const result = buildWriteRequest({ entity, row });
    expect(result).toMatchObject({ ok: true, method: "PUT", path: "/family-members/fm-7" });
  });

  it("includes update-only fields on an update and still drops non-writable ones", () => {
    const entity = { ...base, updateSemantics: { method: "PUT" } } as unknown as DetailEntity;
    const result = buildWriteRequest({ entity, row });
    if (!result.ok) throw new Error(result.error);
    expect(result.body).toEqual({
      firstName: "Emma",
      dateOfBirth: "2011-03-14",
      claimedAsDependent: "yes",
    });
  });

  it("honours a PATCH declaration", () => {
    const entity = { ...base, updateSemantics: { method: "PATCH" } } as unknown as DetailEntity;
    const result = buildWriteRequest({ entity, row });
    expect(result).toMatchObject({ ok: true, method: "PATCH" });
  });

  it("still creates when the match is new", () => {
    const entity = { ...base, updateSemantics: { method: "PUT" } } as unknown as DetailEntity;
    const newRow = { ...row, match: { kind: "new" } } as unknown as CandidateRow;
    const result = buildWriteRequest({ entity, row: newRow });
    expect(result).toMatchObject({ ok: true, method: "POST", path: "/family-members" });
  });

  it("refuses an update whose route still has an unresolved segment", () => {
    const entity = {
      ...base,
      updateSemantics: { method: "PUT" },
      routes: { create: "/x", update: "/accounts/[accountId]/members/[memberId]" },
    } as unknown as DetailEntity;
    const result = buildWriteRequest({ entity, row });
    expect(result).toMatchObject({ ok: false });
    if (result.ok) throw new Error("expected refusal");
    expect(result.error).toContain("[accountId]");
  });
});

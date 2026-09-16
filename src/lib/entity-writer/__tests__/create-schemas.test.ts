// src/lib/entity-writer/__tests__/create-schemas.test.ts
import { describe, it, expect } from "vitest";
import { documentEvidenceEntities, findEntity } from "@/domain/forge/detail-fields";
import { createSchemaFor, createSchemaRefusal } from "../create-schemas";

describe("createSchemaFor", () => {
  /**
   * The guard that keeps `CREATE_SCHEMAS` from silently falling behind the map
   * (final review I4). `buildWriteRequest`'s only caller is the statement-chat
   * map pass, whose entity set is exactly `documentEvidenceEntities()` — so an
   * entity in that set with a `createSchema` the registry does not hold is a
   * row written with no validation at all, which is the state this fix exists
   * to leave behind. Adding a third document-evidence entity and forgetting
   * the registry fails HERE rather than at a customer's 400.
   */
  it("registers a schema for every document-evidence entity that declares one", () => {
    const declared = documentEvidenceEntities().filter(
      (e) => e.createSchema && !e.createSchema.validatesSubset,
    );
    // Non-vacuity: an empty list would make the loop below assert nothing.
    expect(declared.length).toBeGreaterThan(0);
    for (const entity of declared) {
      expect(createSchemaFor(entity), `${entity.id} has no registered create schema`).toBeDefined();
    }
  });

  /**
   * The ratchet above proves SOME schema is registered for every declaring
   * entity, but a registry key that does not match the map's
   * `module#export` is a SILENT lookup miss — `createSchemaFor` returns
   * undefined and the row is written unvalidated, with nothing raising. So pin
   * one real entity end to end, from the map's declaration through the
   * registry to the schema's own refusal.
   */
  it("resolves the family-member schema through its registry key", () => {
    const entity = findEntity("family_member")!;
    expect(createSchemaFor(entity)).toBeDefined();
    expect(createSchemaRefusal(entity, { lastName: "Doe" })).toBe(
      "First Name: First name is required",
    );
  });

  it("returns nothing for an entity that declares no create schema", () => {
    const entity = { ...findEntity("life_insurance_policy")!, createSchema: undefined };
    expect(createSchemaFor(entity)).toBeUndefined();
  });

  it("refuses to validate against a subset schema, which cannot judge the whole body", () => {
    const entity = {
      ...findEntity("life_insurance_policy")!,
      createSchema: {
        module: "@/lib/schemas/insurance-policies",
        export: "insurancePolicyCreateSchema",
        validatesSubset: true,
      },
    };
    expect(createSchemaFor(entity)).toBeUndefined();
    // And therefore no refusal, even for a body the schema would reject.
    expect(createSchemaRefusal(entity, {})).toBeNull();
  });
});

describe("createSchemaRefusal", () => {
  const life = findEntity("life_insurance_policy")!;

  it("translates the failing payload key into the label on screen", () => {
    const refusal = createSchemaRefusal(life, {
      name: "Term 20",
      policyType: "term",
      insuredPerson: "client",
      ownerRef: { kind: "joint" },
      faceValue: 500000,
      termLengthYears: 20,
    });
    // "termIssueYear" is the payload key; "Term issue year" is what the
    // advisor reads. The schema's own sentence is kept verbatim.
    expect(refusal).toMatch(/^Term issue year: Term policies need a term issue year$/);
  });

  it("returns null for a body the schema accepts", () => {
    expect(
      createSchemaRefusal(life, {
        name: "Term 20",
        policyType: "term",
        insuredPerson: "client",
        ownerRef: { kind: "joint" },
        faceValue: 500000,
        termIssueYear: 2020,
        termLengthYears: 20,
      }),
    ).toBeNull();
  });
});

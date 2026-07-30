/**
 * `externalBeneficiaryUpdateSchema` must be PARTIAL — absent keys must stay absent.
 *
 * The PATCH route (`/api/clients/[id]/external-beneficiaries/[beneficiaryId]`)
 * does a wholesale `.set({ ...parsed.data, updatedAt })` with no per-field
 * guard, so anything the schema injects is written verbatim. Both defaulted
 * fields describe WHAT THE BENEFICIARY IS: a rename-only patch on an
 * *individual* beneficiary would silently rewrite it as a public charity.
 *
 * Note the field ordering — `.optional().default("charity")` nests the wrapper
 * two deep, which is why `stripDefault` loops instead of unwrapping once.
 */
import { describe, it, expect } from "vitest";
import {
  externalBeneficiaryCreateSchema,
  externalBeneficiaryUpdateSchema,
} from "../beneficiaries";

describe("externalBeneficiaryUpdateSchema is partial", () => {
  it("parses a one-key body to exactly that one key", () => {
    const result = externalBeneficiaryUpdateSchema.safeParse({ name: "Red Cross" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(Object.keys(result.data)).toHaveLength(1);
    expect(result.data).toEqual({ name: "Red Cross" });
  });

  it("does not convert an individual beneficiary into a charity", () => {
    const result = externalBeneficiaryUpdateSchema.safeParse({ notes: "Updated address" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    // Injected `kind: "charity"` + `charityType: "public"` would be written
    // straight through the route's unguarded spread.
    expect(result.data).not.toHaveProperty("kind");
    expect(result.data).not.toHaveProperty("charityType");
  });

  it("parses an empty body to an empty object", () => {
    const result = externalBeneficiaryUpdateSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({});
  });

  it("still round-trips an explicit kind change", () => {
    const result = externalBeneficiaryUpdateSchema.safeParse({
      kind: "individual",
      name: "Jane Doe",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({ kind: "individual", name: "Jane Doe" });
  });

  it("still rejects a bad enum member", () => {
    expect(externalBeneficiaryUpdateSchema.safeParse({ kind: "trust" }).success).toBe(false);
    expect(
      externalBeneficiaryUpdateSchema.safeParse({ charityType: "donor_advised" }).success,
    ).toBe(false);
  });

  it("still rejects an empty name", () => {
    expect(externalBeneficiaryUpdateSchema.safeParse({ name: "" }).success).toBe(false);
  });
});

describe("externalBeneficiaryCreateSchema keeps its defaults", () => {
  it("still defaults kind and charityType on create", () => {
    const result = externalBeneficiaryCreateSchema.safeParse({ name: "Local Food Bank" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.kind).toBe("charity");
    expect(result.data.charityType).toBe("public");
  });
});

import { describe, it, expect } from "vitest";
import { createHouseholdRelationshipSchema, promoteFamilyMemberSchema } from "../schemas";

describe("createHouseholdRelationshipSchema", () => {
  it("accepts a minimal valid link", () => {
    const r = createHouseholdRelationshipSchema.safeParse({
      counterpartHouseholdId: "3f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8",
      type: "child", viewerSide: "from",
    });
    expect(r.success).toBe(true);
  });
  it("trims and caps the note at 200 chars", () => {
    expect(createHouseholdRelationshipSchema.safeParse({
      counterpartHouseholdId: "3f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8",
      type: "other", viewerSide: "from", note: "x".repeat(201),
    }).success).toBe(false);
  });
  it("rejects unknown types", () => {
    expect(createHouseholdRelationshipSchema.safeParse({
      counterpartHouseholdId: "3f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8",
      type: "roommate", viewerSide: "from",
    }).success).toBe(false);
  });
});

describe("promoteFamilyMemberSchema", () => {
  it("requires name + state", () => {
    expect(promoteFamilyMemberSchema.safeParse({ firstName: "Sarah" }).success).toBe(false);
    expect(promoteFamilyMemberSchema.safeParse({
      firstName: "Sarah", lastName: "Cooper", state: "NY",
    }).success).toBe(true);
  });
  it("rejects a non-USPS state", () => {
    expect(promoteFamilyMemberSchema.safeParse({
      firstName: "Sarah", lastName: "Cooper", state: "ZZ",
    }).success).toBe(false);
  });
});

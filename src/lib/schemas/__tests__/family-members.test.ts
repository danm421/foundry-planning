import { describe, it, expect } from "vitest";
import { FAMILY_RELATIONSHIPS, familyMemberCreateSchema } from "@/lib/schemas/family-members";

describe("familyMemberCreateSchema", () => {
  it("accepts a minimal row", () => {
    expect(familyMemberCreateSchema.safeParse({ firstName: "Emma" }).success).toBe(true);
  });

  it("rejects a missing first name", () => {
    const parsed = familyMemberCreateSchema.safeParse({ lastName: "Doe" });
    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error("expected failure");
    // The review surface shows this as "First Name: <message>", so it must not
    // be zod's own "Invalid input: expected string, received undefined".
    expect(parsed.error.issues.map((i) => i.message)).toEqual(["First name is required"]);
  });

  it("rejects an out-of-enum relationship before it reaches Postgres", () => {
    const parsed = familyMemberCreateSchema.safeParse({ firstName: "Emma", relationship: "ward" });
    expect(parsed.success).toBe(false);
  });

  it("coerces an empty date of birth to null", () => {
    const parsed = familyMemberCreateSchema.safeParse({ firstName: "Emma", dateOfBirth: "" });
    if (!parsed.success) throw new Error("expected success");
    expect(parsed.data.dateOfBirth).toBeNull();
  });

  it("strips claimedAsDependent, which the create route ignores", () => {
    const parsed = familyMemberCreateSchema.safeParse({ firstName: "Emma", claimedAsDependent: "yes" });
    if (!parsed.success) throw new Error("expected success");
    expect(parsed.data).not.toHaveProperty("claimedAsDependent");
  });

  it("accepts a partial inheritance-class override, which is all the dialog ever sends", () => {
    const parsed = familyMemberCreateSchema.safeParse({
      firstName: "Emma",
      inheritanceClassOverride: { PA: "A" },
    });
    if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues));
    expect(parsed.data.inheritanceClassOverride).toEqual({ PA: "A" });
  });

  it("rejects an unknown state key and an unknown class letter", () => {
    expect(familyMemberCreateSchema.safeParse({ firstName: "Emma", inheritanceClassOverride: { XX: "A" } }).success).toBe(false);
    expect(familyMemberCreateSchema.safeParse({ firstName: "Emma", inheritanceClassOverride: { PA: "Z" } }).success).toBe(false);
  });

  it("treats an explicit null override the way the route's `?? {}` does", () => {
    const parsed = familyMemberCreateSchema.safeParse({ firstName: "Emma", inheritanceClassOverride: null });
    if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues));
    expect(parsed.data.inheritanceClassOverride).toEqual({});
  });

  it("lists exactly the relationships the database enum allows", async () => {
    const { familyRelationshipEnum } = await import("@/db/schema");
    expect([...FAMILY_RELATIONSHIPS].sort()).toEqual([...familyRelationshipEnum.enumValues].sort());
  });
});

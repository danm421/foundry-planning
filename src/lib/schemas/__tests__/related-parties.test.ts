import { describe, it, expect } from "vitest";
import {
  relatedPartyCreateSchema,
  relatedPartyUpdateSchema,
} from "@/lib/schemas/related-parties";

describe("relatedPartyCreateSchema", () => {
  it("accepts a trustee", () => {
    const parsed = relatedPartyCreateSchema.safeParse({
      firstName: "Ada", lastName: "Byron", relationshipLabel: "Trustee",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.role).toBe("other");
  });

  it("requires both names, because the table does", () => {
    expect(relatedPartyCreateSchema.safeParse({ firstName: "Ada" }).success).toBe(false);
  });

  it("refuses to claim the primary or spouse slot", () => {
    expect(relatedPartyCreateSchema.safeParse({
      firstName: "Ada", lastName: "Byron", role: "primary",
    }).success).toBe(false);
  });
});

describe("relatedPartyUpdateSchema", () => {
  /**
   * The reason this schema is written out by hand instead of derived.
   * `relatedPartyCreateSchema.partial()` — and `strictPartial()` too — leave the
   * create schema's `.nullish().transform(v => v ?? null)` pipe in place, and
   * that pipe RUNS for an absent key. Either derivation turns a one-key PATCH
   * into a write of `null` over every other column, so sending just a phone
   * number would wipe the contact's email, employer and notes.
   */
  it("returns only the keys the body actually sent", () => {
    const parsed = relatedPartyUpdateSchema.safeParse({ phone: "555-0100" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(Object.keys(parsed.data)).toEqual(["phone"]);
  });

  it("parses an empty body to an empty object", () => {
    expect(relatedPartyUpdateSchema.parse({})).toEqual({});
  });

  it("still lets an explicit null clear a field", () => {
    expect(relatedPartyUpdateSchema.parse({ relationshipLabel: null })).toEqual({
      relationshipLabel: null,
    });
  });

  it("drops a role or householdId the body tries to smuggle in", () => {
    const parsed = relatedPartyUpdateSchema.parse({
      firstName: "Ada",
      role: "primary",
      householdId: "attacker-household",
    });
    expect(parsed).toEqual({ firstName: "Ada" });
  });

  it("still refuses to blank a name the table requires", () => {
    expect(relatedPartyUpdateSchema.safeParse({ lastName: "" }).success).toBe(false);
  });
});

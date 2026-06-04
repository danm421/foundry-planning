import { describe, it, expect } from "vitest";
import { createCrmHouseholdSchema, updateCrmHouseholdSchema } from "../schemas";

describe("createCrmHouseholdSchema contacts", () => {
  it("accepts an optional contacts array", () => {
    const r = createCrmHouseholdSchema.safeParse({
      name: "John Smith",
      advisorId: "adv_1",
      contacts: [{ role: "primary", firstName: "John", lastName: "Smith" }],
    });
    expect(r.success).toBe(true);
  });

  it("accepts a household with no contacts (backward compatible)", () => {
    const r = createCrmHouseholdSchema.safeParse({ name: "X", advisorId: "adv_1" });
    expect(r.success).toBe(true);
  });

  it("accepts an optional dateOfBirth on a contact", () => {
    const r = createCrmHouseholdSchema.safeParse({
      name: "X",
      advisorId: "adv_1",
      contacts: [{ role: "spouse", firstName: "Jane", lastName: "Doe", dateOfBirth: "1970-05-02" }],
    });
    expect(r.success).toBe(true);
  });

  it("rejects a contact with an invalid role", () => {
    const r = createCrmHouseholdSchema.safeParse({
      name: "X",
      advisorId: "adv_1",
      contacts: [{ role: "boss", firstName: "John", lastName: "Smith" }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects a contact missing a first name", () => {
    const r = createCrmHouseholdSchema.safeParse({
      name: "X",
      advisorId: "adv_1",
      contacts: [{ role: "primary", firstName: "", lastName: "Smith" }],
    });
    expect(r.success).toBe(false);
  });

  it("updateCrmHouseholdSchema does not carry inline contacts through to the patch", () => {
    const r = updateCrmHouseholdSchema.safeParse({
      name: "Renamed",
      contacts: [{ role: "primary", firstName: "John", lastName: "Smith" }],
    });
    expect(r.success).toBe(true);
    // `contacts` must be stripped — it's a create-only field and must never
    // reach the household update .set().
    expect(r.success && "contacts" in r.data).toBe(false);
  });

  it("updateCrmHouseholdSchema still allows partial household edits", () => {
    const r = updateCrmHouseholdSchema.safeParse({ status: "active" });
    expect(r.success).toBe(true);
  });
});

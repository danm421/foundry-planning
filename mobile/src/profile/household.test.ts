// mobile/src/profile/household.test.ts
//
// Pure-fn tests for the profile household section: form-field seeding
// (toFields), the firstName-required Save gate (validateFields), and patch
// diffing (householdPatch). Mirrors the API (src/app/api/portal/household/
// route.ts): only changed roles present, only changed fields per role, ""
// on a nullable field means "clear it" (-> null on the wire). firstName is
// NOT NULL in the DB and must never be emitted as "" or null — a blanked
// firstName is simply excluded from the patch (the old value stands), and
// validateFields is what blocks Save so that omission is never silent.
import { describe, it, expect } from "vitest";
import { toFields, validateFields, householdPatch, summaryLine, type ContactFields } from "./household";
import type { PortalContactDTO } from "@contracts";

const contact = (over: Partial<PortalContactDTO> = {}): PortalContactDTO => ({
  id: "c1",
  firstName: "Jane",
  lastName: "Doe",
  email: "jane@example.com",
  phone: "555-1000",
  ...over,
});

describe("toFields", () => {
  it("returns null for a null contact", () => {
    expect(toFields(null)).toBeNull();
  });

  it("maps a full contact straight across", () => {
    expect(toFields(contact())).toEqual({
      firstName: "Jane",
      lastName: "Doe",
      email: "jane@example.com",
      phone: "555-1000",
    });
  });

  it("maps null nullable fields to \"\"", () => {
    expect(toFields(contact({ lastName: null, email: null, phone: null }))).toEqual({
      firstName: "Jane",
      lastName: "",
      email: "",
      phone: "",
    });
  });
});

describe("validateFields", () => {
  it("passes when there's no card to validate (null)", () => {
    expect(validateFields(null)).toBe(true);
  });

  it("passes when firstName is non-empty", () => {
    expect(validateFields(toFields(contact()))).toBe(true);
  });

  it("fails when firstName is blanked", () => {
    const f = toFields(contact()) as ContactFields;
    expect(validateFields({ ...f, firstName: "" })).toBe(false);
  });

  it("fails when firstName is whitespace-only", () => {
    const f = toFields(contact()) as ContactFields;
    expect(validateFields({ ...f, firstName: "   " })).toBe(false);
  });
});

describe("householdPatch", () => {
  it("returns null when nothing changed", () => {
    const primary = contact({ id: "p1" });
    const spouse = contact({ id: "s1", firstName: "John" });
    const result = householdPatch(
      { primary, spouse },
      { primary: toFields(primary), spouse: toFields(spouse) },
    );
    expect(result).toBeNull();
  });

  it("returns null when both contacts are null", () => {
    const result = householdPatch(
      { primary: null, spouse: null },
      { primary: null, spouse: null },
    );
    expect(result).toBeNull();
  });

  it("primary email change only emits just that field under primary", () => {
    const primary = contact({ id: "p1" });
    const spouse = contact({ id: "s1" });
    const editedPrimary = { ...(toFields(primary) as ContactFields), email: "new@x.com" };
    const result = householdPatch(
      { primary, spouse },
      { primary: editedPrimary, spouse: toFields(spouse) },
    );
    expect(result).toEqual({ primary: { email: "new@x.com" } });
  });

  it("clearing phone (\"\" in the field) emits phone: null", () => {
    const primary = contact({ id: "p1" });
    const editedPrimary = { ...(toFields(primary) as ContactFields), phone: "" };
    const result = householdPatch(
      { primary, spouse: null },
      { primary: editedPrimary, spouse: null },
    );
    expect(result).toEqual({ primary: { phone: null } });
  });

  it("clearing lastName and email together emits both as null", () => {
    const primary = contact({ id: "p1" });
    const editedPrimary = { ...(toFields(primary) as ContactFields), lastName: "", email: "" };
    const result = householdPatch(
      { primary, spouse: null },
      { primary: editedPrimary, spouse: null },
    );
    expect(result).toEqual({ primary: { lastName: null, email: null } });
  });

  it("spouse-only edit omits primary entirely", () => {
    const primary = contact({ id: "p1" });
    const spouse = contact({ id: "s1", firstName: "John" });
    const editedSpouse = { ...(toFields(spouse) as ContactFields), phone: "555-2000" };
    const result = householdPatch(
      { primary, spouse },
      { primary: toFields(primary), spouse: editedSpouse },
    );
    expect(result).toEqual({ spouse: { phone: "555-2000" } });
    expect(result).not.toHaveProperty("primary");
  });

  it("both roles changed emits both keys", () => {
    const primary = contact({ id: "p1" });
    const spouse = contact({ id: "s1", firstName: "John" });
    const editedPrimary = { ...(toFields(primary) as ContactFields), email: "new-primary@x.com" };
    const editedSpouse = { ...(toFields(spouse) as ContactFields), email: "new-spouse@x.com" };
    const result = householdPatch(
      { primary, spouse },
      { primary: editedPrimary, spouse: editedSpouse },
    );
    expect(result).toEqual({
      primary: { email: "new-primary@x.com" },
      spouse: { email: "new-spouse@x.com" },
    });
  });

  it("blanking firstName alone (no other change) never emits firstName, and the whole patch collapses to null", () => {
    const primary = contact({ id: "p1" });
    const editedPrimary = { ...(toFields(primary) as ContactFields), firstName: "" };
    const result = householdPatch(
      { primary, spouse: null },
      { primary: editedPrimary, spouse: null },
    );
    expect(result).toBeNull();
  });

  it("blanking firstName alongside a real change excludes firstName but keeps the real change", () => {
    const primary = contact({ id: "p1" });
    const editedPrimary = { ...(toFields(primary) as ContactFields), firstName: "", email: "new@x.com" };
    const result = householdPatch(
      { primary, spouse: null },
      { primary: editedPrimary, spouse: null },
    );
    expect(result).toEqual({ primary: { email: "new@x.com" } });
  });

  it("whitespace-only firstName is treated the same as blank (never emitted)", () => {
    const primary = contact({ id: "p1" });
    const editedPrimary = { ...(toFields(primary) as ContactFields), firstName: "   " };
    const result = householdPatch(
      { primary, spouse: null },
      { primary: editedPrimary, spouse: null },
    );
    expect(result).toBeNull();
  });

  it("a real firstName change is emitted", () => {
    const primary = contact({ id: "p1" });
    const editedPrimary = { ...(toFields(primary) as ContactFields), firstName: "Janet" };
    const result = householdPatch(
      { primary, spouse: null },
      { primary: editedPrimary, spouse: null },
    );
    expect(result).toEqual({ primary: { firstName: "Janet" } });
  });

  it("edited contact null while orig existed contributes no patch for that role (nothing to diff)", () => {
    const primary = contact({ id: "p1" });
    const result = householdPatch(
      { primary, spouse: null },
      { primary: null, spouse: null },
    );
    expect(result).toBeNull();
  });
});

describe("summaryLine", () => {
  it("joins both parts when present", () => {
    expect(summaryLine("married_joint", 92)).toBe("Filing status: married_joint · Plan horizon: through age 92");
  });

  it("omits the plan-horizon clause when lifeExpectancy is null", () => {
    expect(summaryLine("single", null)).toBe("Filing status: single");
  });

  it("omits the filing-status clause when filingStatus is null", () => {
    expect(summaryLine(null, 90)).toBe("Plan horizon: through age 90");
  });

  it("returns null (nothing to render) when both are null", () => {
    expect(summaryLine(null, null)).toBeNull();
  });

  it("age 0 is a valid lifeExpectancy and is still shown (not treated as falsy/missing)", () => {
    expect(summaryLine(null, 0)).toBe("Plan horizon: through age 0");
  });
});

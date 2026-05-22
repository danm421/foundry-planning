import { describe, it, expect } from "vitest";
import { getPrimaryContact, getSpouse, getDisplayName } from "../selectors";

type Contact = { role: "primary" | "spouse" | "dependent" | "other"; firstName: string; lastName: string };
type Household = { id: string; name: string; contacts: Contact[] };

const h = (name: string, contacts: Contact[]): Household => ({ id: "x", name, contacts });

describe("getPrimaryContact", () => {
  it("returns the primary contact when present", () => {
    const c: Contact = { role: "primary", firstName: "Jane", lastName: "Doe" };
    expect(getPrimaryContact(h("Doe", [c]))).toEqual(c);
  });
  it("returns null when no primary contact", () => {
    expect(getPrimaryContact(h("Doe", []))).toBeNull();
    expect(getPrimaryContact(h("Doe", [{ role: "spouse", firstName: "Jim", lastName: "Doe" }]))).toBeNull();
  });
});

describe("getSpouse", () => {
  it("returns the spouse contact when present", () => {
    const c: Contact = { role: "spouse", firstName: "Jim", lastName: "Doe" };
    expect(getSpouse(h("Doe", [c]))).toEqual(c);
  });
  it("returns null when no spouse", () => {
    expect(getSpouse(h("Doe", []))).toBeNull();
  });
});

describe("getDisplayName", () => {
  it("uses primary contact's last name + 'Household' when primary present", () => {
    expect(
      getDisplayName(h("Original Name", [{ role: "primary", firstName: "Jane", lastName: "Doe" }])),
    ).toBe("Doe Household");
  });
  it("falls back to household.name when no primary contact", () => {
    expect(getDisplayName(h("The Smith Family", []))).toBe("The Smith Family");
  });
});

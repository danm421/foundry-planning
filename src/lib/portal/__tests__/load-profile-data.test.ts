// src/lib/portal/__tests__/load-profile-data.test.ts
//
// Mocks @/db + @/db/schema the way load-categorization-context.test.ts does:
// dispatch by table identity via a `_name` tag on the mocked schema object,
// since load-profile-data.ts queries four different tables. `where()` mimics
// the real drizzle chain shape per query — the clients lookup chains
// `.limit(1)`, the other three are awaited directly off `.where()`.
import { describe, it, expect, vi, beforeEach } from "vitest";

const clientSelect = vi.fn();
const contactsSelect = vi.fn();
const familySelect = vi.fn();
const entitiesSelect = vi.fn();

vi.mock("@/db/schema", () => ({
  clients: { _name: "clients" },
  crmHouseholdContacts: { _name: "crm_household_contacts" },
  familyMembers: { _name: "family_members" },
  entities: { _name: "entities" },
}));
vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => a,
  eq: (...a: unknown[]) => a,
}));
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: (tbl: { _name: string }) => ({
        where: () => {
          if (tbl._name === "clients") {
            return { limit: () => Promise.resolve(clientSelect()) };
          }
          if (tbl._name === "crm_household_contacts") return Promise.resolve(contactsSelect());
          if (tbl._name === "family_members") return Promise.resolve(familySelect());
          return Promise.resolve(entitiesSelect());
        },
      }),
    }),
  },
}));

import { loadPortalHousehold, loadPortalFamily, loadPortalTrusts } from "../load-profile-data";

beforeEach(() => {
  clientSelect.mockReset();
  contactsSelect.mockReset();
  familySelect.mockReset();
  entitiesSelect.mockReset();
});

describe("loadPortalHousehold", () => {
  it("maps primary/spouse contacts by role", async () => {
    clientSelect.mockReturnValue([
      { crmHouseholdId: "h1", filingStatus: "married_filing_jointly", lifeExpectancy: 90 },
    ]);
    contactsSelect.mockReturnValue([
      { id: "c1", role: "primary", firstName: "Jane", lastName: "Doe", email: "jane@x.com", phone: "555" },
      { id: "c2", role: "spouse", firstName: "John", lastName: "Doe", email: null, phone: null },
    ]);

    const dto = await loadPortalHousehold("client-1");

    expect(dto).toEqual({
      filingStatus: "married_filing_jointly",
      lifeExpectancy: 90,
      primary: { id: "c1", firstName: "Jane", lastName: "Doe", email: "jane@x.com", phone: "555" },
      spouse: { id: "c2", firstName: "John", lastName: "Doe", email: null, phone: null },
    });
  });

  it("returns a null contact slot when a role has no matching row", async () => {
    clientSelect.mockReturnValue([{ crmHouseholdId: "h1", filingStatus: "single", lifeExpectancy: 95 }]);
    contactsSelect.mockReturnValue([
      { id: "c1", role: "primary", firstName: "Jane", lastName: "Doe", email: null, phone: null },
    ]);

    const dto = await loadPortalHousehold("client-1");

    expect(dto?.primary).not.toBeNull();
    expect(dto?.spouse).toBeNull();
  });

  it("returns null when the client row is missing", async () => {
    clientSelect.mockReturnValue([]);

    const dto = await loadPortalHousehold("missing-client");

    expect(dto).toBeNull();
    expect(contactsSelect).not.toHaveBeenCalled();
  });
});

describe("loadPortalFamily", () => {
  it("maps the five DTO fields", async () => {
    familySelect.mockReturnValue([
      { id: "fm1", firstName: "Kid", lastName: "Doe", relationship: "child", dateOfBirth: "2015-01-01" },
    ]);

    const rows = await loadPortalFamily("client-1");

    expect(rows).toEqual([
      { id: "fm1", firstName: "Kid", lastName: "Doe", relationship: "child", dateOfBirth: "2015-01-01" },
    ]);
  });
});

describe("loadPortalTrusts", () => {
  it("filters to trust entities and coerces the decimal value to a number", async () => {
    entitiesSelect.mockReturnValue([
      { id: "t1", name: "Family Trust", entityType: "trust", value: "125000.50", isGrantor: true },
    ]);

    const rows = await loadPortalTrusts("client-1");

    expect(rows).toEqual([
      { id: "t1", name: "Family Trust", entityType: "trust", value: 125000.5, isGrantor: true },
    ]);
    expect(typeof rows[0].value).toBe("number");
  });
});

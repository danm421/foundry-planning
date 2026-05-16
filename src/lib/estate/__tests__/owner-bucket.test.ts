import { describe, it, expect } from "vitest";
import { classifyAccountOwner } from "../owner-bucket";
import type { ClientData } from "@/engine/types";

function baseData(): ClientData {
  return {
    client: { firstName: "Pat", spouseName: "Sam", dateOfBirth: "1960-01-01" },
    familyMembers: [
      { id: "fm-c", role: "client", firstName: "Pat", lastName: "Doe", dateOfBirth: "1960-01-01" },
      { id: "fm-s", role: "spouse", firstName: "Sam", lastName: "Doe", dateOfBirth: "1962-01-01" },
    ],
    entities: [{ id: "ent-1", name: "Family Trust", entityType: "trust" }],
    accounts: [],
    liabilities: [],
    wills: [],
    planSettings: { inflationRate: 0.02 },
  } as unknown as ClientData;
}

describe("classifyAccountOwner", () => {
  it("classifies a sole client-owned account as the client bucket", () => {
    const data = baseData();
    const account = { id: "a1", name: "IRA", category: "retirement", value: 100,
      owners: [{ kind: "family_member", familyMemberId: "fm-c", percent: 1 }] };
    expect(classifyAccountOwner(data, account as never)).toEqual({
      id: "client", kind: "client", label: "Pat",
    });
  });

  it("classifies a sole spouse-owned account as the spouse bucket", () => {
    const data = baseData();
    const account = { id: "a2", name: "Roth", category: "retirement", value: 50,
      owners: [{ kind: "family_member", familyMemberId: "fm-s", percent: 1 }] };
    expect(classifyAccountOwner(data, account as never)).toEqual({
      id: "spouse", kind: "spouse", label: "Sam",
    });
  });

  it("classifies a mixed family-member account as the joint bucket", () => {
    const data = baseData();
    const account = { id: "a3", name: "Home", category: "real_estate", value: 800,
      owners: [
        { kind: "family_member", familyMemberId: "fm-c", percent: 0.6 },
        { kind: "family_member", familyMemberId: "fm-s", percent: 0.4 },
      ] };
    expect(classifyAccountOwner(data, account as never)).toEqual({
      id: "joint", kind: "joint", label: "Joint",
    });
  });

  it("classifies an entity-owned account as that entity's bucket", () => {
    const data = baseData();
    const account = { id: "a4", name: "Trust Brokerage", category: "taxable", value: 300,
      owners: [{ kind: "entity", entityId: "ent-1", percent: 1 }] };
    expect(classifyAccountOwner(data, account as never)).toEqual({
      id: "entity:ent-1", kind: "trust", label: "Family Trust",
    });
  });
});

import { describe, it, expect } from "vitest";
import { qcdSourceOptions } from "../qcd-sources";

const members = [
  { id: "c", role: "client", firstName: "Jane", dateOfBirth: "1953-03-10" },
  { id: "s", role: "spouse", firstName: "Tom", dateOfBirth: "1961-09-02" },
  { id: "k", role: "child", firstName: "Kid", dateOfBirth: "1990-01-01" },
  { id: "n", role: "spouse", firstName: "NoDob", dateOfBirth: null },
];
const acct = (over: Record<string, unknown>) => ({
  id: "a", name: "IRA", category: "retirement", subType: "traditional_ira",
  ownerFamilyMemberId: "c", ownerEntityId: null, ...over,
});

describe("qcdSourceOptions", () => {
  it("keeps traditional, SEP and SIMPLE IRAs owned by the client or spouse", () => {
    const out = qcdSourceOptions({
      accounts: [
        acct({ id: "t" }),
        acct({ id: "sep", subType: "sep_ira" }),
        acct({ id: "sim", subType: "simple_ira", ownerFamilyMemberId: "s" }),
      ],
      familyMembers: members,
    });
    expect(out.map((o) => o.id)).toEqual(["t", "sep", "sim"]);
  });

  it("drops a 401(k), a Roth, an entity-owned IRA, a child's IRA and an owner with no DOB", () => {
    const out = qcdSourceOptions({
      accounts: [
        acct({ id: "k401", subType: "401k" }),
        acct({ id: "roth", subType: "roth_ira" }),
        acct({ id: "ent", ownerEntityId: "e1" }),
        acct({ id: "kid", ownerFamilyMemberId: "k" }),
        acct({ id: "nodob", ownerFamilyMemberId: "n" }),
        acct({ id: "taxable", category: "taxable", subType: "brokerage" }),
        acct({ id: "joint", ownerFamilyMemberId: null }),
      ],
      familyMembers: members,
    });
    expect(out).toEqual([]);
  });

  it("derives the owner, the carry-on spouse and both start years", () => {
    const [jane, tom] = qcdSourceOptions({
      accounts: [acct({ id: "j", name: "Jane IRA" }), acct({ id: "t", ownerFamilyMemberId: "s" })],
      familyMembers: members.slice(0, 3),
    });
    // Born March 1953: 70½ in 2023; RMD age 73 -> 2026.
    expect(jane).toEqual({
      id: "j", name: "Jane IRA", owner: "client", ownerFirstName: "Jane",
      spouseFirstName: "Tom", eligibleFromYear: 2023, rmdStartYear: 2026,
    });
    // Born September 1961: 70½ in 2032 (71 once past June); RMD age 75 -> 2036.
    expect(tom).toMatchObject({ owner: "spouse", spouseFirstName: "Jane", eligibleFromYear: 2032, rmdStartYear: 2036 });
  });

  it("has a null spouse name for a single household", () => {
    const [o] = qcdSourceOptions({ accounts: [acct({})], familyMembers: [members[0]] });
    expect(o.spouseFirstName).toBeNull();
  });
});

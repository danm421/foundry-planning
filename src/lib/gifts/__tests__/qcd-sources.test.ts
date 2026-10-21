import { describe, it, expect } from "vitest";
import { qcdSourceOptions, qcdSourceProblems } from "../qcd-sources";

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
      spouseFirstName: "Tom", eligibleFromYear: 2023, rmdStartYear: 2026, inherited: false,
    });
    // Born September 1961: 70½ in 2032 (71 once past June); RMD age 75 -> 2036.
    expect(tom).toMatchObject({ owner: "spouse", spouseFirstName: "Jane", eligibleFromYear: 2032, rmdStartYear: 2036 });
  });

  it("has a null spouse name for a single household", () => {
    const [o] = qcdSourceOptions({ accounts: [acct({})], familyMembers: [members[0]] });
    expect(o.spouseFirstName).toBeNull();
  });

  it("marks an inherited IRA, whose RMDs are already due", () => {
    const [inh, own] = qcdSourceOptions({
      accounts: [acct({ id: "inh", inherited: true }), acct({ id: "own" })],
      familyMembers: members,
    });
    expect(inh.inherited).toBe(true);
    expect(own.inherited).toBe(false);
  });
});

describe("qcdSourceProblems", () => {
  it("says in plain words why each non-source account can't fund a QCD, and has no entry for a source", () => {
    const problems = qcdSourceProblems({
      accounts: [
        acct({ id: "ok", name: "Jane IRA" }),
        acct({ id: "nodob", name: "Spouse IRA", ownerFamilyMemberId: "n" }),
        acct({ id: "roth", name: "Jane Roth", subType: "roth_ira" }),
        acct({ id: "ent", name: "Trust IRA", ownerEntityId: "e1" }),
        acct({ id: "joint", name: "Joint IRA", ownerFamilyMemberId: null }),
        acct({ id: "kid", name: "Kid IRA", ownerFamilyMemberId: "k" }),
      ],
      familyMembers: members,
    });
    expect(problems).toEqual({
      nodob: "NoDob has no date of birth on file, so Spouse IRA can't fund a QCD.",
      roth: "Jane Roth isn't a traditional, SEP or SIMPLE IRA, so it can't fund a QCD.",
      ent: "Trust IRA isn't owned by the client or co-client alone, so it can't fund a QCD.",
      joint: "Joint IRA isn't owned by the client or co-client alone, so it can't fund a QCD.",
      kid: "Kid IRA isn't owned by the client or co-client alone, so it can't fund a QCD.",
    });
  });
});

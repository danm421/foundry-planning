import { describe, it, expect } from "vitest";
import { changeOwner, changeBeneficiaries, changeWillBequests } from "../estate-flow-edits";
import type { ClientData, Account, BeneficiaryRef } from "@/engine/types";

function baseData(): ClientData {
  const account = {
    id: "acc-1",
    name: "Brokerage",
    owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
    beneficiaries: [],
  } as unknown as Account;
  return { accounts: [account], entities: [], wills: [] } as unknown as ClientData;
}

describe("changeOwner", () => {
  it("replaces the owners array on the matching account", () => {
    const next = changeOwner(baseData(), "acc-1", [
      { kind: "family_member", familyMemberId: "fm-client", percent: 0.6 },
      { kind: "family_member", familyMemberId: "fm-spouse", percent: 0.4 },
    ]);
    expect(next.accounts[0].owners).toHaveLength(2);
    expect(next.accounts[0].owners?.[1]).toMatchObject({ percent: 0.4 });
  });

  it("does not mutate the input data", () => {
    const input = baseData();
    changeOwner(input, "acc-1", [
      { kind: "family_member", familyMemberId: "fm-spouse", percent: 1 },
    ]);
    expect(
      (input.accounts[0].owners?.[0] as { kind: "family_member"; familyMemberId: string }).familyMemberId,
    ).toBe("fm-client");
  });

  it("returns data unchanged when the account id is unknown", () => {
    const input = baseData();
    const next = changeOwner(input, "acc-missing", []);
    expect(next.accounts[0]).toBe(input.accounts[0]);
  });
});

describe("changeBeneficiaries", () => {
  it("replaces beneficiaries on an account", () => {
    const refs: BeneficiaryRef[] = [
      { id: "b1", tier: "primary", percentage: 100, householdRole: "spouse", sortOrder: 0 },
    ];
    const next = changeBeneficiaries(baseData(), "account", "acc-1", refs);
    expect(next.accounts[0].beneficiaries).toEqual(refs);
  });

  it("replaces beneficiaries on an entity", () => {
    const data = {
      accounts: [],
      entities: [{ id: "ent-1", name: "Family Trust", beneficiaries: [] }],
      wills: [],
    } as unknown as ClientData;
    const next = changeBeneficiaries(data, "entity", "ent-1", [
      { id: "b2", tier: "primary", percentage: 100, familyMemberId: "fm-kid", sortOrder: 0 },
    ]);
    expect(next.entities?.[0].beneficiaries).toHaveLength(1);
  });

  it("does not mutate the input", () => {
    const input = baseData();
    changeBeneficiaries(input, "account", "acc-1", [
      { id: "b1", tier: "primary", percentage: 100, householdRole: "client", sortOrder: 0 },
    ]);
    expect(input.accounts[0].beneficiaries).toEqual([]);
  });
});

describe("changeWillBequests", () => {
  it("replaces bequests and residuary recipients on the matching will", () => {
    const data = {
      accounts: [],
      entities: [],
      wills: [{ id: "will-1", grantor: "client", bequests: [], residuaryRecipients: [] }],
    } as unknown as ClientData;
    const next = changeWillBequests(
      data,
      "will-1",
      [
        {
          id: "bq-1",
          name: "House",
          kind: "asset",
          assetMode: "specific",
          accountId: "acc-1",
          liabilityId: null,
          percentage: 100,
          condition: "always",
          sortOrder: 0,
          recipients: [],
        },
      ],
      [{ recipientKind: "family_member", recipientId: "fm-kid", percentage: 100, sortOrder: 0 }],
    );
    expect(next.wills?.[0].bequests).toHaveLength(1);
    expect(next.wills?.[0].residuaryRecipients).toHaveLength(1);
  });

  it("does not mutate the input", () => {
    const data = {
      accounts: [],
      entities: [],
      wills: [{ id: "will-1", grantor: "client", bequests: [], residuaryRecipients: [] }],
    } as unknown as ClientData;
    changeWillBequests(
      data,
      "will-1",
      [
        {
          id: "bq-1",
          name: "House",
          kind: "asset",
          assetMode: "specific",
          accountId: "acc-1",
          liabilityId: null,
          percentage: 100,
          condition: "always",
          sortOrder: 0,
          recipients: [],
        },
      ],
      [{ recipientKind: "family_member", recipientId: "fm-kid", percentage: 100, sortOrder: 0 }],
    );
    expect(data.wills?.[0].bequests).toHaveLength(0);
  });

  it("returns data unchanged when the will id is unknown", () => {
    const data = {
      accounts: [],
      entities: [],
      wills: [{ id: "will-1", grantor: "client", bequests: [], residuaryRecipients: [] }],
    } as unknown as ClientData;
    const next = changeWillBequests(data, "will-missing", [], []);
    expect(next.wills?.[0]).toBe(data.wills?.[0]);
  });
});

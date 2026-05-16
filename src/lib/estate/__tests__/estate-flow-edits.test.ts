import { describe, it, expect } from "vitest";
import { changeOwner, changeBeneficiaries, upsertWills } from "../estate-flow-edits";
import type { ClientData, Account, BeneficiaryRef, Will } from "@/engine/types";

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

  it("returns data unchanged when the account id is unknown", () => {
    const input = baseData();
    const next = changeBeneficiaries(input, "account", "acc-missing", []);
    expect(next.accounts[0]).toBe(input.accounts[0]);
  });

  it("returns data unchanged when the entity id is unknown", () => {
    const data = {
      accounts: [],
      entities: [{ id: "ent-1", name: "Family Trust", beneficiaries: [] }],
      wills: [],
    } as unknown as ClientData;
    const next = changeBeneficiaries(data, "entity", "ent-missing", []);
    expect(next.entities?.[0]).toBe(data.entities?.[0]);
  });
});

describe("upsertWills", () => {
  const will = (id: string, grantor: "client" | "spouse"): Will =>
    ({ id, grantor, bequests: [], residuaryRecipients: [] }) as Will;

  it("replaces an existing will by id", () => {
    const data = {
      accounts: [],
      entities: [],
      wills: [will("will-1", "client")],
    } as unknown as ClientData;
    const replacement: Will = {
      ...will("will-1", "client"),
      bequests: [
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
    };
    const next = upsertWills(data, [replacement]);
    expect(next.wills).toHaveLength(1);
    expect(next.wills?.[0].bequests).toHaveLength(1);
  });

  it("appends a will with a new id", () => {
    const data = {
      accounts: [],
      entities: [],
      wills: [will("will-1", "client")],
    } as unknown as ClientData;
    const next = upsertWills(data, [will("will-2", "spouse")]);
    expect(next.wills).toHaveLength(2);
    expect(next.wills?.[1].grantor).toBe("spouse");
  });

  it("replaces one will and appends another in a single call", () => {
    const data = {
      accounts: [],
      entities: [],
      wills: [will("will-1", "client")],
    } as unknown as ClientData;
    const next = upsertWills(data, [will("will-1", "client"), will("will-2", "spouse")]);
    expect(next.wills?.map((w) => w.id)).toEqual(["will-1", "will-2"]);
  });

  it("creates the wills array when the client has none", () => {
    const data = { accounts: [], entities: [] } as unknown as ClientData;
    const next = upsertWills(data, [will("will-1", "client")]);
    expect(next.wills).toHaveLength(1);
  });

  it("does not mutate the input", () => {
    const data = {
      accounts: [],
      entities: [],
      wills: [will("will-1", "client")],
    } as unknown as ClientData;
    upsertWills(data, [will("will-2", "spouse")]);
    expect(data.wills).toHaveLength(1);
  });

  it("returns data unchanged when wills is empty", () => {
    const data = {
      accounts: [],
      entities: [],
      wills: [will("will-1", "client")],
    } as unknown as ClientData;
    expect(upsertWills(data, [])).toBe(data);
  });
});

import { describe, it, expect, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));

import { accounts, accountOwners, familyMembers, externalBeneficiaries } from "@/db/schema";
import { checkQcdSource } from "../qcd-source-check";

const CLIENT = "c0000000-0000-0000-0000-000000000001";
const IRA = "a0000000-0000-0000-0000-000000000001";
const CHARITY = "b0000000-0000-0000-0000-000000000001";
const OWNER = "f0000000-0000-0000-0000-000000000001";

interface World {
  account?: { category: string; subType: string } | null;
  owners?: { familyMemberId: string | null; entityId?: string | null }[];
  ownerRole?: string | null;
  charity?: { kind: string; charityType: string } | null;
}

/** A handle whose `select().from(table).where()` answers by TABLE, so the
 *  check's query order doesn't matter. */
function fakeHandle(w: World) {
  const byTable = new Map<unknown, unknown[]>([
    [accounts, w.account === null ? [] : [w.account ?? { category: "retirement", subType: "traditional_ira" }]],
    [
      accountOwners,
      (w.owners ?? [{ familyMemberId: OWNER, entityId: null }]).map((o) => ({ entityId: null, ...o })),
    ],
    [familyMembers, w.ownerRole === null ? [] : [{ role: w.ownerRole ?? "client" }]],
    [
      externalBeneficiaries,
      w.charity === null ? [] : [w.charity ?? { kind: "charity", charityType: "public" }],
    ],
  ]);
  return {
    select: () => ({
      from: (t: unknown) => ({ where: () => Promise.resolve(byTable.get(t) ?? []) }),
    }),
  } as never;
}

const input = { qcdAccountId: IRA, recipientExternalBeneficiaryId: CHARITY, grantor: "client" as const };

describe("checkQcdSource", () => {
  it("accepts a client-owned traditional IRA to a public charity", async () => {
    expect(await checkQcdSource(fakeHandle({}), CLIENT, input)).toBeNull();
  });

  it("accepts SEP and SIMPLE IRAs", async () => {
    for (const subType of ["sep_ira", "simple_ira"]) {
      expect(
        await checkQcdSource(fakeHandle({ account: { category: "retirement", subType } }), CLIENT, input),
      ).toBeNull();
    }
  });

  it("rejects a 401(k)", async () => {
    const msg = await checkQcdSource(
      fakeHandle({ account: { category: "retirement", subType: "401k" } }),
      CLIENT,
      input,
    );
    expect(msg).toMatch(/traditional, SEP or SIMPLE IRA/);
  });

  it("rejects a Roth IRA", async () => {
    const msg = await checkQcdSource(
      fakeHandle({ account: { category: "retirement", subType: "roth_ira" } }),
      CLIENT,
      input,
    );
    expect(msg).toMatch(/traditional, SEP or SIMPLE IRA/);
  });

  it("rejects an IRA that isn't this client's", async () => {
    expect(await checkQcdSource(fakeHandle({ account: null }), CLIENT, input)).toBe(
      "QCD account not found for this client",
    );
  });

  it("rejects an IRA owned by the spouse when the giver is the client", async () => {
    const msg = await checkQcdSource(fakeHandle({ ownerRole: "spouse" }), CLIENT, input);
    expect(msg).toBe("A QCD must come from an IRA owned by the giver");
  });

  it("rejects an IRA with more than one owner", async () => {
    const msg = await checkQcdSource(
      fakeHandle({ owners: [{ familyMemberId: OWNER }, { familyMemberId: "f0000000-0000-0000-0000-000000000002" }] }),
      CLIENT,
      input,
    );
    expect(msg).toBe("A QCD must come from an IRA owned by the giver");
  });

  it("rejects an entity-owned IRA", async () => {
    const msg = await checkQcdSource(
      fakeHandle({ owners: [{ familyMemberId: null, entityId: "e1" }] }),
      CLIENT,
      input,
    );
    expect(msg).toBe("A QCD must come from an IRA owned by the giver");
  });

  it("rejects a joint giver", async () => {
    const msg = await checkQcdSource(fakeHandle({}), CLIENT, { ...input, grantor: "joint" });
    expect(msg).toBe("A QCD has one giver — the IRA's owner");
  });

  it("rejects a private charity", async () => {
    const msg = await checkQcdSource(
      fakeHandle({ charity: { kind: "charity", charityType: "private" } }),
      CLIENT,
      input,
    );
    expect(msg).toBe("A QCD must go to a public charity");
  });

  it("rejects an individual beneficiary", async () => {
    const msg = await checkQcdSource(
      fakeHandle({ charity: { kind: "individual", charityType: "public" } }),
      CLIENT,
      input,
    );
    expect(msg).toBe("A QCD must go to a public charity");
  });

  it("rejects a charity that isn't this client's", async () => {
    expect(await checkQcdSource(fakeHandle({ charity: null }), CLIENT, input)).toBe(
      "Recipient external beneficiary not found for this client",
    );
  });
});

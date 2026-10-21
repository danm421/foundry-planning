import { describe, it, expect, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn(async () => undefined) }));
vi.mock("@/lib/db-scoping", () => ({
  assertAccountsInClient: vi.fn(async () => ({ ok: true })),
  assertLiabilitiesInClient: vi.fn(async () => ({ ok: true })),
}));

import { gifts, accounts, accountOwners, familyMembers, externalBeneficiaries } from "@/db/schema";
import { updateGiftForClient, createGiftForClient } from "@/lib/clients/gifts-writes";

const CLIENT = "c0000000-0000-0000-0000-000000000001";
const FIRM = "d0000000-0000-0000-0000-000000000001";
const GIFT = "90000000-0000-0000-0000-000000000001";
const IRA = "a0000000-0000-0000-0000-000000000001";
const CHARITY = "b0000000-0000-0000-0000-000000000001";
const OWNER = "f0000000-0000-0000-0000-000000000001";

const qcdRow = {
  id: GIFT,
  clientId: CLIENT,
  year: 2027,
  amount: "20000",
  grantor: "client" as const,
  recipientEntityId: null,
  recipientFamilyMemberId: null,
  recipientExternalBeneficiaryId: CHARITY,
  accountId: null,
  liabilityId: null,
  businessEntityId: null,
  percent: null,
  parentGiftId: null,
  qcdAccountId: IRA,
  qcdAmountMode: "fixed" as const,
};
const cashRow = { ...qcdRow, qcdAccountId: null, qcdAmountMode: null };

/** A transaction stand-in: selects answer by TABLE; `update().set()` records
 *  the values and returns `returned` from `.returning()`. */
function fakeTx(existing: unknown, opts: { ownerRole?: string; charityType?: string } = {}) {
  const sets: Record<string, unknown>[] = [];
  const inserts: Record<string, unknown>[] = [];
  const byTable = new Map<unknown, unknown[]>([
    [gifts, [existing]],
    [accounts, [{ category: "retirement", subType: "traditional_ira" }]],
    [accountOwners, [{ familyMemberId: OWNER, entityId: null }]],
    [familyMembers, [{ role: opts.ownerRole ?? "client", id: OWNER }]],
    [externalBeneficiaries, [{ id: CHARITY, kind: "charity", charityType: opts.charityType ?? "public" }]],
  ]);
  const tx = {
    select: () => ({
      from: (t: unknown) => ({ where: () => Promise.resolve(byTable.get(t) ?? []) }),
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => {
        sets.push(v);
        return { where: () => ({ returning: async () => [{ ...(existing as object), ...v }] }) };
      },
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserts.push(v);
        return { returning: async () => [{ id: GIFT, clientId: CLIENT, ...v }] };
      },
    }),
  };
  return { tx: tx as never, sets, inserts };
}

const base = { clientId: CLIENT, firmId: FIRM, giftId: GIFT };

describe("updateGiftForClient — switching a gift between Cash and From an IRA", () => {
  it("clears BOTH QCD columns together when the patch nulls both", async () => {
    const { tx, sets } = fakeTx(qcdRow);
    const res = await updateGiftForClient({
      ...base,
      tx,
      input: { qcdAccountId: null, qcdAmountMode: null, amount: 20_000 },
    });
    expect(res.ok).toBe(true);
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({ qcdAccountId: null, qcdAmountMode: null });
    expect(res.ok && res.data.qcdAccountId).toBeNull();
    expect(res.ok && res.data.qcdAmountMode).toBeNull();
  });

  it("refuses a switch back to cash that leaves a $0 amount", async () => {
    const { tx, sets } = fakeTx({ ...qcdRow, amount: "0", qcdAmountMode: "full_rmd" });
    const res = await updateGiftForClient({
      ...base,
      tx,
      input: { qcdAccountId: null, qcdAmountMode: null },
    });
    expect(res.ok).toBe(false);
    expect(sets).toHaveLength(0);
  });

  it("refuses amount 0 on an asset gift (no $0 valuation override)", async () => {
    const { tx, sets } = fakeTx({
      ...cashRow,
      amount: null,
      recipientExternalBeneficiaryId: null,
      recipientEntityId: "e0000000-0000-0000-0000-000000000001",
      accountId: IRA,
      percent: "0.5",
    });
    const res = await updateGiftForClient({ ...base, tx, input: { amount: 0 } });
    expect(res.ok).toBe(false);
    expect(sets).toHaveLength(0);
  });

  it("sets BOTH QCD columns when a cash gift to a charity becomes a QCD", async () => {
    const { tx, sets } = fakeTx(cashRow);
    const res = await updateGiftForClient({
      ...base,
      tx,
      input: { qcdAccountId: IRA, qcdAmountMode: "fixed" },
    });
    expect(res.ok).toBe(true);
    expect(sets[0]).toMatchObject({ qcdAccountId: IRA, qcdAmountMode: "fixed" });
  });

  it("allows changing only the amount mode on an existing QCD", async () => {
    const { tx, sets } = fakeTx(qcdRow);
    const res = await updateGiftForClient({
      ...base,
      tx,
      input: { qcdAmountMode: "full_rmd", amount: 0 },
    });
    expect(res.ok).toBe(true);
    expect(sets[0]).toMatchObject({ qcdAmountMode: "full_rmd", amount: "0" });
    expect(sets[0]).not.toHaveProperty("qcdAccountId");
  });

  it("refuses an amount-mode-only patch that leaves a full-RMD QCD with an amount", async () => {
    const { tx, sets } = fakeTx(qcdRow);
    const res = await updateGiftForClient({ ...base, tx, input: { qcdAmountMode: "full_rmd" } });
    expect(res.ok).toBe(false);
    expect(sets).toHaveLength(0);
  });

  it("validates a grantor-only edit against the merged row (IRA stays the client's)", async () => {
    const { tx, sets } = fakeTx(qcdRow, { ownerRole: "client" });
    const res = await updateGiftForClient({ ...base, tx, input: { grantor: "spouse" } });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toBe("A QCD must come from an IRA owned by the giver");
    expect(sets).toHaveLength(0);
  });

  it("refuses a recipient-only edit that moves a QCD to a private charity", async () => {
    const { tx, sets } = fakeTx(qcdRow, { charityType: "private" });
    const res = await updateGiftForClient({
      ...base,
      tx,
      input: { recipientExternalBeneficiaryId: CHARITY },
    });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toBe("A QCD must go to a public charity");
    expect(sets).toHaveLength(0);
  });

  it("does not run the QCD checks for an edit that touches none of the QCD-relevant fields", async () => {
    const { tx, sets } = fakeTx(qcdRow, { ownerRole: "spouse" });
    const res = await updateGiftForClient({ ...base, tx, input: { notes: "hi" } });
    expect(res.ok).toBe(true);
    expect(sets).toHaveLength(1);
  });
});

describe("createGiftForClient — QCD", () => {
  it("stores both QCD columns", async () => {
    const { tx, inserts } = fakeTx(cashRow);
    const res = await createGiftForClient({
      clientId: CLIENT,
      firmId: FIRM,
      tx,
      input: {
        year: 2027,
        amount: 20_000,
        grantor: "client",
        recipientExternalBeneficiaryId: CHARITY,
        qcdAccountId: IRA,
        qcdAmountMode: "fixed",
      },
    });
    expect(res.ok).toBe(true);
    expect(inserts[0]).toMatchObject({ qcdAccountId: IRA, qcdAmountMode: "fixed", amount: "20000" });
  });

  it("refuses a QCD from an IRA the giver doesn't own", async () => {
    const { tx, inserts } = fakeTx(cashRow, { ownerRole: "spouse" });
    const res = await createGiftForClient({
      clientId: CLIENT,
      firmId: FIRM,
      tx,
      input: {
        year: 2027,
        amount: 20_000,
        grantor: "client",
        recipientExternalBeneficiaryId: CHARITY,
        qcdAccountId: IRA,
        qcdAmountMode: "fixed",
      },
    });
    expect(res.ok).toBe(false);
    expect(inserts).toHaveLength(0);
  });

  it("leaves a plain cash gift's QCD columns null", async () => {
    const { tx, inserts } = fakeTx(cashRow);
    await createGiftForClient({
      clientId: CLIENT,
      firmId: FIRM,
      tx,
      input: { year: 2027, amount: 1000, grantor: "client", recipientExternalBeneficiaryId: CHARITY },
    });
    expect(inserts[0]).toMatchObject({ qcdAccountId: null, qcdAmountMode: null });
  });
});

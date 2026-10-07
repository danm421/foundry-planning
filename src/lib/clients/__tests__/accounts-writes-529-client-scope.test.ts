// A 529's grantor, beneficiary and Roth-rollover target must belong to the
// client the account is written under, on create and on update. Unit test: the
// database and the id-ownership checks are faked, so it needs no DB.
import { describe, it, expect, vi, beforeEach } from "vitest";

const CLIENT = "11111111-1111-4111-8111-111111111111";
const FIRM = "org_firm";
const OWN_FM = "22222222-2222-4222-8222-222222222222";
const OWN_ROTH = "33333333-3333-4333-8333-333333333333";
const OTHER_FM = "44444444-4444-4444-8444-444444444444";
const OTHER_ACCOUNT = "55555555-5555-4555-8555-555555555555";
const ACCOUNT = "66666666-6666-4666-8666-666666666666";

// Ids that belong to CLIENT. Anything else is another client's row.
const OWN_IDS = new Set([OWN_FM, OWN_ROTH, ACCOUNT]);

const writes = vi.fn();
const existing529 = {
  id: ACCOUNT,
  clientId: CLIENT,
  category: "education_savings",
  subType: "other",
  beneficiaryFamilyMemberId: OWN_FM,
  beneficiaryName: null,
  isDefaultChecking: false,
  inheritedDeathYear: null,
  inheritedOwnerBirthYear: null,
  inheritedPayoutFromYear: null,
  inheritedPayoutThroughYear: null,
};

vi.mock("@/db", () => {
  const tx = {
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        writes(v);
        return { returning: async () => [{ ...existing529, ...v }] };
      },
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => {
        writes(v);
        return { where: () => ({ returning: async () => [{ ...existing529, ...v }] }) };
      },
    }),
    delete: () => ({ where: async () => undefined }),
  };
  return {
    db: {
      select: () => ({ from: () => ({ where: async () => [existing529] }) }),
      transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});

type FkCheck = { ok: true } | { ok: false; reason: string };
function inClient(clientId: string, ids: (string | null | undefined)[]): FkCheck {
  const bad = ids.find((id) => id && (clientId !== CLIENT || !OWN_IDS.has(id)));
  return bad ? { ok: false, reason: `${bad} not owned by this client` } : { ok: true };
}
vi.mock("@/lib/db-scoping", () => ({
  assertAccountsInClient: async (c: string, ids: (string | null | undefined)[]) => inClient(c, ids),
  assertFamilyMembersInClient: async (c: string, ids: (string | null | undefined)[]) => inClient(c, ids),
  assertEntitiesInClient: async () => ({ ok: true }),
  assertModelPortfoliosInFirm: async () => ({ ok: true }),
  assertTickerPortfoliosInFirm: async () => ({ ok: true }),
}));
vi.mock("@/lib/clients/authz", () => ({
  verifyClientAccess: async () => ({ ok: true, permission: "edit", firmId: FIRM, access: "own" }),
}));
vi.mock("../base-case", () => ({ baseCaseScenarioId: async () => "scenario-1" }));
vi.mock("@/lib/audit", () => ({
  recordCreate: async () => undefined,
  recordUpdate: async () => undefined,
  recordDelete: async () => undefined,
}));
vi.mock("@/lib/audit/snapshots/account", () => ({
  toAccountSnapshot: async () => ({}),
  ACCOUNT_FIELD_LABELS: {},
}));

import { createAccountForClient, updateAccountForClient } from "../accounts-writes";

const create = (input: Record<string, unknown>) =>
  createAccountForClient({
    clientId: CLIENT,
    firmId: FIRM,
    actorId: "user_1",
    input: { name: "College", category: "education_savings", beneficiaryFamilyMemberId: OWN_FM, ...input },
  });

const update = (input: Record<string, unknown>) =>
  updateAccountForClient({ clientId: CLIENT, firmId: FIRM, actorId: "user_1", accountId: ACCOUNT, input });

beforeEach(() => writes.mockClear());

describe("529 references must belong to the account's client", () => {
  it.each([
    ["grantorFamilyMemberId", OTHER_FM],
    ["beneficiaryFamilyMemberId", OTHER_FM],
    ["rothRolloverAccountId", OTHER_ACCOUNT],
  ])("create rejects a %s from another client", async (field, id) => {
    const res = await create({ [field]: id });
    expect(res).toMatchObject({ ok: false, status: 400 });
    expect(writes).not.toHaveBeenCalled();
  });

  it.each([
    ["grantorFamilyMemberId", OTHER_FM],
    ["beneficiaryFamilyMemberId", OTHER_FM],
    ["rothRolloverAccountId", OTHER_ACCOUNT],
  ])("update rejects a %s from another client", async (field, id) => {
    const res = await update({ [field]: id });
    expect(res).toMatchObject({ ok: false, status: 400 });
    expect(writes).not.toHaveBeenCalled();
  });

  it("create accepts the client's own grantor, beneficiary and rollover account", async () => {
    const res = await create({ grantorFamilyMemberId: OWN_FM, rothRolloverAccountId: OWN_ROTH });
    expect(res.ok).toBe(true);
    expect(writes).toHaveBeenCalled();
  });

  it("update accepts the client's own ids and clearing them", async () => {
    const res = await update({
      grantorFamilyMemberId: OWN_FM,
      rothRolloverAccountId: OWN_ROTH,
      beneficiaryFamilyMemberId: null,
      beneficiaryName: "Junior",
    });
    expect(res.ok).toBe(true);
    expect(writes).toHaveBeenCalled();
  });
});

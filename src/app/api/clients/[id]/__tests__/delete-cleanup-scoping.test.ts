/**
 * DELETE routes clean up dependent rows only for a row the client owns.
 *
 * Deleting a base row also prunes the scenario changes that target it and, for
 * family members and entities, the will designations naming it. Those helpers
 * key on the bare id (neither table has a client column), so the route has to
 * prove the id is THIS client's first. An id that is not answers 404 and
 * touches nothing.
 *
 * Mocked at the db / auth seams, so it runs without a database. The fake db
 * ignores WHERE: a query on `ownTable` finds the client's own row, and every
 * other query finds nothing — exactly what a client-scoped read or
 * `DELETE … RETURNING` sees for an id belonging to someone else.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTableName, type Table } from "drizzle-orm";

const OWN_ID = "00000000-0000-4000-8000-0000000000aa";
const OTHER_ID = "00000000-0000-4000-8000-0000000000bb";
const CLIENT = "00000000-0000-4000-8000-0000000000cc";

let ownTable: string | null = null;

vi.mock("@/db", async () => {
  const { getTableName } = await import("drizzle-orm");
  const rowsFor = (t: unknown) =>
    getTableName(t as Table) === ownTable ? [{ id: OWN_ID, isDefault: false }] : [];
  const query = (t: unknown) => {
    const rows = rowsFor(t);
    return {
      where: () =>
        Object.assign(Promise.resolve(rows), { returning: () => Promise.resolve(rows) }),
    };
  };
  const tx = {
    select: () => ({ from: (t: unknown) => query(t) }),
    delete: (t: unknown) => query(t),
  };
  return { db: { ...tx, transaction: (cb: (t: typeof tx) => unknown) => cb(tx) } };
});
vi.mock("@/lib/db-helpers", () => ({
  requireOrgAndUser: vi.fn().mockResolvedValue({ orgId: "f1", userId: "u1" }),
  requireOrgId: vi.fn().mockResolvedValue("f1"),
}));
vi.mock("@/lib/clients/authz", () => ({
  requireClientEditAccess: vi.fn().mockResolvedValue({ firmId: "f1", access: "own" }),
  verifyClientAccess: vi.fn().mockResolvedValue({ ok: true, firmId: "f1", permission: "edit" }),
}));
vi.mock("@/lib/authz", () => ({
  requireActiveSubscriptionForFirm: vi.fn().mockResolvedValue(undefined),
  authErrorResponse: () => null,
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/scenario/prune-changes", () => ({ pruneOrphanScenarioChanges: vi.fn() }));
vi.mock("@/lib/estate/cleanup-will-recipients", () => ({
  cleanupWillRecipientReferences: vi.fn(),
}));

import {
  entities,
  expenses,
  familyMembers,
  incomes,
  savingsRules,
  withdrawalStrategies,
} from "@/db/schema";
import { pruneOrphanScenarioChanges } from "@/lib/scenario/prune-changes";
import { cleanupWillRecipientReferences } from "@/lib/estate/cleanup-will-recipients";
import { DELETE as deleteFamilyMember } from "../family-members/[memberId]/route";
import { DELETE as deleteEntity } from "../entities/[entityId]/route";
import { DELETE as deleteIncome } from "../incomes/[incomeId]/route";
import { DELETE as deleteExpense } from "../expenses/[expenseId]/route";
import { DELETE as deleteSavingsRule } from "../savings-rules/[ruleId]/route";
import { DELETE as deleteWithdrawalStrategy } from "../withdrawal-strategy/[strategyId]/route";

const req = () => new Request("http://localhost/x", { method: "DELETE" }) as never;
const ctx = (param: string, value: string) =>
  ({ params: Promise.resolve({ id: CLIENT, [param]: value }) }) as never;

const ROUTES = [
  {
    name: "family member",
    table: familyMembers,
    willKind: "family_member",
    call: (id: string) => deleteFamilyMember(req(), ctx("memberId", id)),
  },
  {
    name: "entity",
    table: entities,
    willKind: "entity",
    call: (id: string) => deleteEntity(req(), ctx("entityId", id)),
  },
  {
    name: "income",
    table: incomes,
    call: (id: string) => deleteIncome(req(), ctx("incomeId", id)),
  },
  {
    name: "expense",
    table: expenses,
    call: (id: string) => deleteExpense(req(), ctx("expenseId", id)),
  },
  {
    name: "savings rule",
    table: savingsRules,
    call: (id: string) => deleteSavingsRule(req(), ctx("ruleId", id)),
  },
  {
    name: "withdrawal strategy",
    table: withdrawalStrategies,
    call: (id: string) => deleteWithdrawalStrategy(req(), ctx("strategyId", id)),
  },
] as const;

describe.each(ROUTES)("DELETE $name", (route) => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("answers 404 and cleans up nothing for an id that is not this client's", async () => {
    ownTable = null;
    const res = await route.call(OTHER_ID);

    expect(res.status).toBe(404);
    expect(pruneOrphanScenarioChanges).not.toHaveBeenCalled();
    expect(cleanupWillRecipientReferences).not.toHaveBeenCalled();
  });

  it("still cleans up after deleting this client's own row", async () => {
    ownTable = getTableName(route.table);
    const res = await route.call(OWN_ID);

    expect(res.status).toBe(204);
    expect(pruneOrphanScenarioChanges).toHaveBeenCalledWith(expect.anything(), OWN_ID);
    if ("willKind" in route) {
      expect(cleanupWillRecipientReferences).toHaveBeenCalledWith(
        expect.anything(),
        route.willKind,
        OWN_ID,
      );
    }
  });
});

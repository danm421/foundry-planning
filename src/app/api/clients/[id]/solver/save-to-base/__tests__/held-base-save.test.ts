// Live-DB: the Solver's Save to base facts writing held Details-editor changes.
//
// - A held add lands in base under its OWN id, so the entries the save leaves
//   behind (held back, switched off) still name a real row. A taken id fails
//   the whole save: nothing is written.
// - A held family member removal clears what names it by bare id (will
//   recipients, scenario changes), as the family-members DELETE route does —
//   and only for this client's own member.
//
// Every row lives on throwaway clients in a firm nothing else uses; a run
// killed before its teardown is swept by a later run once it is an hour old.
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  accountOwners,
  accounts,
  clients,
  crmHouseholds,
  familyMembers,
  planSettings,
  scenarioChanges,
  scenarios,
  willBequestRecipients,
  willBequests,
  willResiduaryRecipients,
  wills,
} from "@/db/schema";
import { createTestClientWithScenario } from "@/test/factories";

const FIRM_ID = "firm_test_solver_base_save";
const HAS_DB = !!process.env.DATABASE_URL;

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn().mockResolvedValue({ userId: "user_test" }) }));
vi.mock("@/lib/db-helpers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db-helpers")>()),
  requireOrgId: vi.fn(async () => "firm_test_solver_base_save"),
}));
vi.mock("@/lib/clients/authz", () => ({
  requireClientEditAccess: vi.fn(async () => ({ firmId: "firm_test_solver_base_save", access: "own" })),
}));
vi.mock("@/lib/authz", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/authz")>()),
  requireActiveSubscriptionForFirm: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

import { POST } from "../route";

async function dropTestClients(which: SQL) {
  const rows = await db
    .select({ id: clients.id, householdId: clients.crmHouseholdId })
    .from(clients)
    .where(and(eq(clients.firmId, FIRM_ID), which));
  for (const c of rows) {
    await db.delete(clients).where(eq(clients.id, c.id));
    await db.delete(crmHouseholds).where(eq(crmHouseholds.id, c.householdId));
  }
}

describe.skipIf(!HAS_DB)("Save to base facts — held editor changes on a real database", () => {
  let clientId: string;
  let baseScenarioId: string;
  let otherClientId: string;
  const saveId = randomUUID();

  beforeAll(async () => {
    await dropTestClients(sql`${clients.createdAt} < now() - interval '1 hour'`);
    ({ clientId, scenarioId: baseScenarioId } = await createTestClientWithScenario(FIRM_ID));
    await db.insert(planSettings).values({ clientId, scenarioId: baseScenarioId, planStartYear: 2026, planEndYear: 2056 });
    ({ clientId: otherClientId } = await createTestClientWithScenario(FIRM_ID));
  });

  afterAll(async () => {
    const ids = [clientId, otherClientId].filter(Boolean);
    if (ids.length > 0) await dropTestClients(inArray(clients.id, ids));
  });

  const save = (mutations: unknown[]) =>
    POST(
      new Request(`http://localhost/api/clients/${clientId}/solver/save-to-base`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "base", mutations }),
      }) as never,
      { params: Promise.resolve({ id: clientId }) },
    );

  const held = (op: "add" | "remove", targetKind: string, targetId: string, payload: unknown) => ({
    kind: "held-change",
    op,
    targetKind,
    targetId,
    payload,
    saveId,
  });

  const member = (id: string, firstName: string) => ({ id, firstName, relationship: "child" });

  async function memberRow(id: string) {
    const [row] = await db.select().from(familyMembers).where(eq(familyMembers.id, id));
    return row;
  }

  it("writes a held add under its own id", async () => {
    const kim = randomUUID();
    const acct = randomUUID();
    const res = await save([
      held("add", "family_member", kim, member(kim, "Kim")),
      held("add", "account", acct, {
        id: acct,
        name: "Kim's brokerage",
        category: "taxable",
        subType: "brokerage",
        value: 1000,
        basis: 1000,
        owners: [{ kind: "family_member", familyMemberId: kim, percent: 1 }],
      }),
    ]);
    expect(res.status).toBe(200);

    expect((await memberRow(kim))?.clientId).toBe(clientId);
    const [account] = await db.select().from(accounts).where(eq(accounts.id, acct));
    expect(account).toMatchObject({ clientId, scenarioId: baseScenarioId, name: "Kim's brokerage" });
    const owners = await db.select().from(accountOwners).where(eq(accountOwners.accountId, acct));
    expect(owners.map((o) => o.familyMemberId)).toEqual([kim]);
  });

  it("fails the whole save, writing nothing, when a held add's id is taken", async () => {
    const taken = randomUUID();
    await db.insert(familyMembers).values({ id: taken, clientId, firstName: "Taken" });
    const fresh = randomUUID();

    const res = await save([
      held("add", "family_member", fresh, member(fresh, "Fresh")),
      held("add", "family_member", taken, member(taken, "Overwritten")),
    ]);
    expect(res.ok).toBe(false);

    expect(await memberRow(fresh)).toBeUndefined();
    expect((await memberRow(taken))?.firstName).toBe("Taken");
    const named = await db
      .select({ id: familyMembers.id })
      .from(familyMembers)
      .where(and(eq(familyMembers.clientId, clientId), inArray(familyMembers.firstName, ["Fresh", "Overwritten"])));
    expect(named).toEqual([]);
  });

  /** A member of `owner`, named by a will bequest, the will's residuary clause
   *  and (when `scenarioId` is given) a saved scenario change. */
  async function namedMember(owner: string, scenarioId?: string) {
    const id = randomUUID();
    await db.insert(familyMembers).values({ id, clientId: owner, firstName: "Named" });
    const [will] = await db.insert(wills).values({ clientId: owner, grantor: "client" }).returning();
    const [bequest] = await db
      .insert(willBequests)
      .values({ willId: will.id, name: "Everything", kind: "asset", assetMode: "all_assets", percentage: "100", condition: "always", sortOrder: 0 })
      .returning();
    await db.insert(willBequestRecipients).values({ bequestId: bequest.id, recipientKind: "family_member", recipientId: id, percentage: "100", sortOrder: 0 });
    await db.insert(willResiduaryRecipients).values({ willId: will.id, recipientKind: "family_member", recipientId: id, percentage: "100", sortOrder: 0 });
    if (scenarioId) {
      await db.insert(scenarioChanges).values({
        scenarioId,
        opType: "edit",
        targetKind: "family_member",
        targetId: id,
        payload: { firstName: { from: "Named", to: "Renamed" } },
        orderIndex: 0,
      });
    }
    return { id, willId: will.id };
  }

  async function namingRows(id: string) {
    const [bequestRecipients, residuary, changes] = await Promise.all([
      db.select().from(willBequestRecipients).where(eq(willBequestRecipients.recipientId, id)),
      db.select().from(willResiduaryRecipients).where(eq(willResiduaryRecipients.recipientId, id)),
      db.select().from(scenarioChanges).where(eq(scenarioChanges.targetId, id)),
    ]);
    return { bequestRecipients, residuary, changes };
  }

  it("removing a family member clears the will recipients and scenario changes naming it", async () => {
    const [scenario] = await db
      .insert(scenarios)
      .values({ clientId, name: "held-base-save what-if", isBaseCase: false })
      .returning();
    const { id, willId } = await namedMember(clientId, scenario.id);
    expect((await namingRows(id)).changes).toHaveLength(1);

    const res = await save([held("remove", "family_member", id, null)]);
    expect(res.status).toBe(200);

    expect(await memberRow(id)).toBeUndefined();
    expect(await namingRows(id)).toEqual({ bequestRecipients: [], residuary: [], changes: [] });
    await db.delete(wills).where(eq(wills.id, willId));
  });

  it("removing another client's family member deletes and clears nothing", async () => {
    const { id } = await namedMember(otherClientId);

    const res = await save([held("remove", "family_member", id, null)]);
    expect(res.status).toBe(200);

    expect((await memberRow(id))?.clientId).toBe(otherClientId);
    const left = await namingRows(id);
    expect(left.bequestRecipients).toHaveLength(1);
    expect(left.residuary).toHaveLength(1);
  });
});

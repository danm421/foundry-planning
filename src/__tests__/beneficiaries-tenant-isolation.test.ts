/**
 * Behavioral tenant-isolation test for the beneficiary routes added in the
 * estate-beneficiaries plan (routes 6–10). Exercises the real DB via Drizzle
 * and drives the route handlers directly, mocking `getOrgId` to flip between
 * two firms.
 *
 * Complements the structural contract check in `tenant-isolation.test.ts`
 * (which only greps for a `getOrgId()` call). This test proves the call is
 * wired into the enforcement path on the new routes specifically.
 *
 * Requires DATABASE_URL. If unavailable, the suite is skipped — the
 * structural contract test still enforces the CI-level invariant.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

// Load .env.local into process.env before importing anything that reads
// DATABASE_URL at module-init time (src/db/index.ts does).
try {
  const envPath = resolve(process.cwd(), ".env.local");
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const [, k, vRaw] = m;
    if (process.env[k]) continue;
    let v = vRaw.trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[k] = v;
  }
} catch {
  // .env.local not present — the describe.skipIf below handles this.
}

const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

// Mock BEFORE importing anything that touches the module (route handlers).
vi.mock("@/lib/db-helpers", () => ({
  getOrgId: vi.fn(),
  requireOrgId: vi.fn(),
}));

const FIRM_A = "firm_isolation_test_a";
const FIRM_B = "firm_isolation_test_b";

d("beneficiaries tenant isolation", () => {
  let dbMod: typeof import("@/db");
  let schema: typeof import("@/db/schema");
  let helpers: typeof import("@/lib/db-helpers");
  let drizzleOrm: typeof import("drizzle-orm");

  beforeAll(async () => {
    dbMod = await import("@/db");
    schema = await import("@/db/schema");
    helpers = await import("@/lib/db-helpers");
    drizzleOrm = await import("drizzle-orm");
  });

  async function cleanup() {
    const { db } = dbMod;
    const {
      clients,
      familyMembers,
      accounts,
      scenarios,
      externalBeneficiaries,
      beneficiaryDesignations,
    } = schema;
    const { inArray } = drizzleOrm;

    const testClients = await db
      .select({ id: clients.id })
      .from(clients)
      .where(inArray(clients.firmId, [FIRM_A, FIRM_B]));
    const ids = testClients.map((c) => c.id);
    if (ids.length === 0) return;

    await db
      .delete(beneficiaryDesignations)
      .where(inArray(beneficiaryDesignations.clientId, ids));
    await db
      .delete(externalBeneficiaries)
      .where(inArray(externalBeneficiaries.clientId, ids));
    await db.delete(accounts).where(inArray(accounts.clientId, ids));
    await db.delete(scenarios).where(inArray(scenarios.clientId, ids));
    await db.delete(familyMembers).where(inArray(familyMembers.clientId, ids));
    await db.delete(clients).where(inArray(clients.firmId, [FIRM_A, FIRM_B]));
  }

  async function setupFirmWithClient(firmId: string) {
    const { db } = dbMod;
    const { clients, scenarios, familyMembers, accounts } = schema;
    const [client] = await db
      .insert(clients)
      .values({
        firmId,
        advisorId: "advisor_isolation_test",
        firstName: "Test",
        lastName: firmId,
        dateOfBirth: "1970-01-01",
        retirementAge: 65,
        planEndAge: 90,
        lifeExpectancy: 90,
        filingStatus: "married_joint",
      })
      .returning();
    const [scenario] = await db
      .insert(scenarios)
      .values({ clientId: client.id, name: "base", isBaseCase: true })
      .returning();
    const [fm] = await db
      .insert(familyMembers)
      .values({ clientId: client.id, firstName: "Kid" })
      .returning();
    const [account] = await db
      .insert(accounts)
      .values({
        clientId: client.id,
        scenarioId: scenario.id,
        name: "Test Acct",
        category: "taxable",
        subType: "brokerage",
      })
      .returning();
    return { clientId: client.id, accountId: account.id, fmId: fm.id };
  }

  beforeEach(async () => {
    await cleanup();
    vi.mocked(helpers.getOrgId).mockReset();
  });

  it("Firm B cannot GET Firm A's external beneficiaries list", async () => {
    const a = await setupFirmWithClient(FIRM_A);
    const { db } = dbMod;
    const { externalBeneficiaries } = schema;

    await db
      .insert(externalBeneficiaries)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values({ clientId: a.clientId, name: "Stanford" } as any);

    vi.mocked(helpers.getOrgId).mockResolvedValue(FIRM_B);
    const { GET } = await import(
      "@/app/api/clients/[id]/external-beneficiaries/route"
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET(new Request("http://x") as any, {
      params: Promise.resolve({ id: a.clientId }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    expect(res.status).toBe(404);
  });

  it("Firm B cannot PUT a designation onto Firm A's account", async () => {
    const a = await setupFirmWithClient(FIRM_A);
    vi.mocked(helpers.getOrgId).mockResolvedValue(FIRM_B);
    const { PUT } = await import(
      "@/app/api/clients/[id]/accounts/[accountId]/beneficiaries/route"
    );
    const body = [
      { tier: "primary", percentage: 100, familyMemberId: a.fmId },
    ];
    const res = await PUT(
      new Request("http://x", {
        method: "PUT",
        body: JSON.stringify(body),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
      {
        params: Promise.resolve({ id: a.clientId, accountId: a.accountId }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    );
    expect(res.status).toBe(404);
  });

  it("Firm A cannot designate Firm B's family member onto its own account", async () => {
    const a = await setupFirmWithClient(FIRM_A);
    const b = await setupFirmWithClient(FIRM_B);
    vi.mocked(helpers.getOrgId).mockResolvedValue(FIRM_A);
    const { PUT } = await import(
      "@/app/api/clients/[id]/accounts/[accountId]/beneficiaries/route"
    );
    const body = [
      { tier: "primary", percentage: 100, familyMemberId: b.fmId },
    ];
    const res = await PUT(
      new Request("http://x", {
        method: "PUT",
        body: JSON.stringify(body),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
      {
        params: Promise.resolve({ id: a.clientId, accountId: a.accountId }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    );
    expect(res.status).toBe(400);
  });

  it("Firm A cannot PATCH its account with Firm B's family member as owner", async () => {
    const a = await setupFirmWithClient(FIRM_A);
    const b = await setupFirmWithClient(FIRM_B);
    vi.mocked(helpers.getOrgId).mockResolvedValue(FIRM_A);
    vi.mocked(helpers.requireOrgId).mockResolvedValue(FIRM_A);
    const { PATCH } = await import(
      "@/app/api/clients/[id]/accounts/[accountId]/route"
    );
    const body = { ownerFamilyMemberId: b.fmId };
    const res = await PATCH(
      new Request("http://x", {
        method: "PATCH",
        body: JSON.stringify(body),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
      {
        params: Promise.resolve({ id: a.clientId, accountId: a.accountId }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    );
    expect(res.status).toBe(400);
  });
});

/**
 * Behavioral tenant-isolation test for the gift routes added in the
 * gift-exemption-ledger plan. Exercises the real DB via Drizzle and drives
 * the route handlers directly, mocking `getOrgId` to flip between two firms.
 *
 * Complements the structural contract check in `tenant-isolation.test.ts`
 * (which only greps for a `getOrgId()` call). This test proves the call is
 * wired into the enforcement path on the new gift routes specifically, and
 * additionally exercises the "revocable trust recipient is rejected" case.
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
}));

const FIRM_A = "firm_gifts_test_a";
const FIRM_B = "firm_gifts_test_b";

type FirmSeed = {
  clientId: string;
  scenarioId: string;
  fmId: string;
  accountId: string;
  irrevTrustId: string;
  revTrustId: string;
};

d("gifts tenant isolation", () => {
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
      entities,
      gifts,
    } = schema;
    const { inArray } = drizzleOrm;

    const testClients = await db
      .select({ id: clients.id })
      .from(clients)
      .where(inArray(clients.firmId, [FIRM_A, FIRM_B]));
    const ids = testClients.map((c) => c.id);
    if (ids.length === 0) return;

    await db.delete(gifts).where(inArray(gifts.clientId, ids));
    await db.delete(entities).where(inArray(entities.clientId, ids));
    await db.delete(accounts).where(inArray(accounts.clientId, ids));
    await db.delete(scenarios).where(inArray(scenarios.clientId, ids));
    await db.delete(familyMembers).where(inArray(familyMembers.clientId, ids));
    await db.delete(clients).where(inArray(clients.firmId, [FIRM_A, FIRM_B]));
  }

  async function setupFirmWithClient(firmId: string): Promise<FirmSeed> {
    const { db } = dbMod;
    const { clients, scenarios, familyMembers, accounts, entities } = schema;
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      .returning();
    const [scenario] = await db
      .insert(scenarios)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values({ clientId: client.id, name: "base", isDefault: true } as any)
      .returning();
    const [fm] = await db
      .insert(familyMembers)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values({ clientId: client.id, firstName: "Kid" } as any)
      .returning();
    const [account] = await db
      .insert(accounts)
      .values({
        clientId: client.id,
        scenarioId: scenario.id,
        name: "Test Acct",
        category: "taxable",
        subType: "brokerage",
        owner: "client",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      .returning();
    const [irrevTrust] = await db
      .insert(entities)
      .values({
        clientId: client.id,
        name: `${firmId} SLAT`,
        entityType: "trust",
        trustSubType: "slat",
        isIrrevocable: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      .returning();
    const [revTrust] = await db
      .insert(entities)
      .values({
        clientId: client.id,
        name: `${firmId} Rev`,
        entityType: "trust",
        trustSubType: "revocable",
        isIrrevocable: false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      .returning();
    return {
      clientId: client.id,
      scenarioId: scenario.id,
      fmId: fm.id,
      accountId: account.id,
      irrevTrustId: irrevTrust.id,
      revTrustId: revTrust.id,
    };
  }

  beforeEach(async () => {
    await cleanup();
    vi.mocked(helpers.getOrgId).mockReset();
  });

  it("Firm B cannot GET Firm A's gifts list", async () => {
    const a = await setupFirmWithClient(FIRM_A);
    const { db } = dbMod;
    const { gifts } = schema;

    await db.insert(gifts).values({
      clientId: a.clientId,
      year: 2026,
      amount: "1000000",
      grantor: "client",
      recipientEntityId: a.irrevTrustId,
      useCrummeyPowers: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    vi.mocked(helpers.getOrgId).mockResolvedValue(FIRM_B);
    const { GET } = await import("@/app/api/clients/[id]/gifts/route");
    const res = await GET(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new Request("http://x") as any,
      {
        params: Promise.resolve({ id: a.clientId }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    );
    expect(res.status).toBe(404);
  });

  it("Firm B cannot POST a gift to Firm A's client", async () => {
    const a = await setupFirmWithClient(FIRM_A);
    vi.mocked(helpers.getOrgId).mockResolvedValue(FIRM_B);
    const { POST } = await import("@/app/api/clients/[id]/gifts/route");
    const body = {
      year: 2026,
      amount: 100_000,
      grantor: "client",
      recipientEntityId: a.irrevTrustId,
    };
    const res = await POST(
      new Request("http://x", {
        method: "POST",
        body: JSON.stringify(body),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
      {
        params: Promise.resolve({ id: a.clientId }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    );
    expect(res.status).toBe(404);
  });

  it("Firm A cannot POST a gift with Firm B's trust as recipient", async () => {
    const a = await setupFirmWithClient(FIRM_A);
    const b = await setupFirmWithClient(FIRM_B);
    vi.mocked(helpers.getOrgId).mockResolvedValue(FIRM_A);
    const { POST } = await import("@/app/api/clients/[id]/gifts/route");
    const body = {
      year: 2026,
      amount: 100_000,
      grantor: "client",
      recipientEntityId: b.irrevTrustId,
    };
    const res = await POST(
      new Request("http://x", {
        method: "POST",
        body: JSON.stringify(body),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
      {
        params: Promise.resolve({ id: a.clientId }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    );
    expect(res.status).toBe(400);
  });

  it("Firm A cannot POST a gift with Firm B's family member as recipient", async () => {
    const a = await setupFirmWithClient(FIRM_A);
    const b = await setupFirmWithClient(FIRM_B);
    vi.mocked(helpers.getOrgId).mockResolvedValue(FIRM_A);
    const { POST } = await import("@/app/api/clients/[id]/gifts/route");
    const body = {
      year: 2026,
      amount: 10_000,
      grantor: "client",
      recipientFamilyMemberId: b.fmId,
    };
    const res = await POST(
      new Request("http://x", {
        method: "POST",
        body: JSON.stringify(body),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
      {
        params: Promise.resolve({ id: a.clientId }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    );
    expect(res.status).toBe(400);
  });

  it("POST to a revocable trust recipient returns 400", async () => {
    const a = await setupFirmWithClient(FIRM_A);
    vi.mocked(helpers.getOrgId).mockResolvedValue(FIRM_A);
    const { POST } = await import("@/app/api/clients/[id]/gifts/route");
    const body = {
      year: 2026,
      amount: 100_000,
      grantor: "client",
      recipientEntityId: a.revTrustId,
    };
    const res = await POST(
      new Request("http://x", {
        method: "POST",
        body: JSON.stringify(body),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
      {
        params: Promise.resolve({ id: a.clientId }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    );
    expect(res.status).toBe(400);
  });
});

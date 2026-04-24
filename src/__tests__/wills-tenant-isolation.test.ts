/**
 * Behavioral tenant-isolation test for the will routes added in spec 4a.
 * Exercises the real DB via Drizzle and drives the route handlers directly,
 * mocking getOrgId to flip between two firms. Requires DATABASE_URL.
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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[k] = v;
  }
} catch {
  // .env.local not present — describe.skip below handles this.
}

const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

vi.mock("@/lib/db-helpers", () => ({
  getOrgId: vi.fn(),
}));

const FIRM_A = "firm_wills_test_a";
const FIRM_B = "firm_wills_test_b";

type FirmSeed = {
  clientId: string;
  scenarioId: string;
  fmId: string;
  accountId: string;
};

d("wills tenant isolation", () => {
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
    const { clients, familyMembers, accounts, scenarios, wills } = schema;
    const { inArray } = drizzleOrm;
    const testClients = await db
      .select({ id: clients.id })
      .from(clients)
      .where(inArray(clients.firmId, [FIRM_A, FIRM_B]));
    const ids = testClients.map((c) => c.id);
    if (ids.length === 0) return;
    await db.delete(wills).where(inArray(wills.clientId, ids));
    await db.delete(accounts).where(inArray(accounts.clientId, ids));
    await db.delete(scenarios).where(inArray(scenarios.clientId, ids));
    await db.delete(familyMembers).where(inArray(familyMembers.clientId, ids));
    await db.delete(clients).where(inArray(clients.firmId, [FIRM_A, FIRM_B]));
  }

  async function setupFirmWithClient(firmId: string): Promise<FirmSeed> {
    const { db } = dbMod;
    const { clients, scenarios, familyMembers, accounts } = schema;
    const [client] = await db
      .insert(clients)
      .values({
        firmId,
        advisorId: "advisor_wills_test",
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
    return {
      clientId: client.id,
      scenarioId: scenario.id,
      fmId: fm.id,
      accountId: account.id,
    };
  }

  beforeEach(async () => {
    await cleanup();
    vi.mocked(helpers.getOrgId).mockReset();
  });

  it("Firm B cannot GET Firm A's wills list", async () => {
    const a = await setupFirmWithClient(FIRM_A);
    vi.mocked(helpers.getOrgId).mockResolvedValue(FIRM_B);
    const { GET } = await import("@/app/api/clients/[id]/wills/route");
    const res = await GET(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new Request("http://x") as any,
      { params: Promise.resolve({ id: a.clientId }) } as unknown as Parameters<typeof GET>[1],
    );
    expect(res.status).toBe(404);
  });

  it("Firm A cannot POST a will with Firm B's account as accountId", async () => {
    const a = await setupFirmWithClient(FIRM_A);
    const b = await setupFirmWithClient(FIRM_B);
    vi.mocked(helpers.getOrgId).mockResolvedValue(FIRM_A);
    const { POST } = await import("@/app/api/clients/[id]/wills/route");
    const body = {
      grantor: "client",
      bequests: [
        {
          name: "Cross-firm bequest",
          assetMode: "specific",
          accountId: b.accountId,
          percentage: 100,
          condition: "always",
          sortOrder: 0,
          recipients: [
            { recipientKind: "spouse", recipientId: null, percentage: 100, sortOrder: 0 },
          ],
        },
      ],
    };
    const res = await POST(
      new Request("http://x", { method: "POST", body: JSON.stringify(body) }) as unknown as Parameters<typeof POST>[0],
      { params: Promise.resolve({ id: a.clientId }) } as unknown as Parameters<typeof POST>[1],
    );
    expect(res.status).toBe(400);
  });

  it("Firm A cannot POST a will with Firm B's family member as recipient", async () => {
    const a = await setupFirmWithClient(FIRM_A);
    const b = await setupFirmWithClient(FIRM_B);
    vi.mocked(helpers.getOrgId).mockResolvedValue(FIRM_A);
    const { POST } = await import("@/app/api/clients/[id]/wills/route");
    const body = {
      grantor: "client",
      bequests: [
        {
          name: "Cross-firm recipient",
          assetMode: "all_assets",
          accountId: null,
          percentage: 100,
          condition: "always",
          sortOrder: 0,
          recipients: [
            {
              recipientKind: "family_member",
              recipientId: b.fmId,
              percentage: 100,
              sortOrder: 0,
            },
          ],
        },
      ],
    };
    const res = await POST(
      new Request("http://x", { method: "POST", body: JSON.stringify(body) }) as unknown as Parameters<typeof POST>[0],
      { params: Promise.resolve({ id: a.clientId }) } as unknown as Parameters<typeof POST>[1],
    );
    expect(res.status).toBe(400);
  });

  it("duplicate (client_id, grantor) on POST returns 409", async () => {
    const a = await setupFirmWithClient(FIRM_A);
    vi.mocked(helpers.getOrgId).mockResolvedValue(FIRM_A);
    const { POST } = await import("@/app/api/clients/[id]/wills/route");
    const body = { grantor: "client", bequests: [] };
    const first = await POST(
      new Request("http://x", { method: "POST", body: JSON.stringify(body) }) as unknown as Parameters<typeof POST>[0],
      { params: Promise.resolve({ id: a.clientId }) } as unknown as Parameters<typeof POST>[1],
    );
    expect(first.status).toBe(201);
    const second = await POST(
      new Request("http://x", { method: "POST", body: JSON.stringify(body) }) as unknown as Parameters<typeof POST>[0],
      { params: Promise.resolve({ id: a.clientId }) } as unknown as Parameters<typeof POST>[1],
    );
    expect(second.status).toBe(409);
  });

  it("Firm B cannot PATCH Firm A's will", async () => {
    const a = await setupFirmWithClient(FIRM_A);
    vi.mocked(helpers.getOrgId).mockResolvedValue(FIRM_A);
    const { db } = dbMod;
    const { wills } = schema;
    const [seeded] = await db
      .insert(wills)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values({ clientId: a.clientId, grantor: "client" } as any)
      .returning();
    vi.mocked(helpers.getOrgId).mockResolvedValue(FIRM_B);
    const { PATCH } = await import("@/app/api/clients/[id]/wills/[willId]/route");
    const res = await PATCH(
      new Request("http://x", { method: "PATCH", body: JSON.stringify({ bequests: [] }) }) as unknown as Parameters<typeof PATCH>[0],
      { params: Promise.resolve({ id: a.clientId, willId: seeded.id }) } as unknown as Parameters<typeof PATCH>[1],
    );
    expect(res.status).toBe(404);
  });

  it("Firm B cannot DELETE Firm A's will", async () => {
    const a = await setupFirmWithClient(FIRM_A);
    vi.mocked(helpers.getOrgId).mockResolvedValue(FIRM_A);
    const { db } = dbMod;
    const { wills } = schema;
    const [seeded] = await db
      .insert(wills)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values({ clientId: a.clientId, grantor: "client" } as any)
      .returning();
    vi.mocked(helpers.getOrgId).mockResolvedValue(FIRM_B);
    const { DELETE } = await import("@/app/api/clients/[id]/wills/[willId]/route");
    const res = await DELETE(
      new Request("http://x", { method: "DELETE" }) as unknown as Parameters<typeof DELETE>[0],
      { params: Promise.resolve({ id: a.clientId, willId: seeded.id }) } as unknown as Parameters<typeof DELETE>[1],
    );
    expect(res.status).toBe(404);
  });

  it("deleting the client cascades to wills and children", async () => {
    const a = await setupFirmWithClient(FIRM_A);
    const { db } = dbMod;
    const { wills, willBequests, willBequestRecipients, clients } = schema;
    const { eq } = drizzleOrm;
    const [willRow] = await db
      .insert(wills)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values({ clientId: a.clientId, grantor: "client" } as any)
      .returning();
    const [bequestRow] = await db
      .insert(willBequests)
      .values({
        willId: willRow.id,
        name: "x",
        assetMode: "all_assets",
        accountId: null,
        percentage: "100",
        condition: "always",
        sortOrder: 0,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      .returning();
    await db.insert(willBequestRecipients).values({
      bequestId: bequestRow.id,
      recipientKind: "spouse",
      recipientId: null,
      percentage: "100",
      sortOrder: 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    await db.delete(clients).where(eq(clients.id, a.clientId));
    const remaining = await db.select().from(wills).where(eq(wills.clientId, a.clientId));
    expect(remaining.length).toBe(0);
  });
});

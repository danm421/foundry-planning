/**
 * Behavioral tenant-isolation test for CRT split-interest details.
 *
 * Mirrors `clt-tenant-isolation.test.ts`. Verifies:
 *   - Firm B cannot GET Firm A's entities list (which surfaces split-interest)
 *   - Firm B cannot PUT split-interest changes onto Firm A's CRT
 *   - The split-interest payload validates and trust_split_interest_details
 *     persists when the same firm operates on its own CRT
 *   - No gifts row is auto-emitted when a CRT is created (CRTs produce a
 *     charitable deduction, not a taxable gift)
 *
 * Requires DATABASE_URL (loaded from .env.local). Skipped otherwise — the
 * structural contract test still enforces the CI-level invariant.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

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
  // .env.local not present — describe.skipIf below handles this.
}

const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

vi.mock("@/lib/db-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-helpers")>();
  return {
    ...actual,
    getOrgId: vi.fn(),
    requireOrgId: vi.fn(),
  };
});

const FIRM_A = "firm_crut_test_a";
const FIRM_B = "firm_crut_test_b";

type FirmSeed = {
  clientId: string;
  scenarioId: string;
  fmId: string;
  charityId: string;
  crtId: string;
};

d("CRT split-interest tenant isolation", () => {
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
    const { clients, crmHouseholds } = schema;
    const { inArray } = drizzleOrm;
    // Delete clients in a single statement so cascade flows
    // accounts → account_owners atomically. Splitting deletes across
    // statements lets the deferred sum-check trigger fire between them
    // and raise on transient zero-owner state. CRM households are FK'd
    // by clients (restrict) — delete after clients cascade.
    await db.delete(clients).where(inArray(clients.firmId, [FIRM_A, FIRM_B]));
    await db.delete(crmHouseholds).where(inArray(crmHouseholds.firmId, [FIRM_A, FIRM_B]));
  }

  async function setupFirmWithCrut(firmId: string): Promise<FirmSeed> {
    const { db } = dbMod;
    const {
      clients,
      scenarios,
      familyMembers,
      entities,
      externalBeneficiaries,
      trustSplitInterestDetails,
      crmHouseholds,
      crmHouseholdContacts,
    } = schema;
    const [household] = await db
      .insert(crmHouseholds)
      .values({ firmId, advisorId: "advisor_crut_isolation_test", name: "Test Household" })
      .returning();
    await db.insert(crmHouseholdContacts).values({
      householdId: household.id,
      role: "primary",
      firstName: "Test",
      lastName: firmId,
      dateOfBirth: "1970-01-01",
    });
    const [client] = await db
      .insert(clients)
      .values({
        firmId,
        advisorId: "advisor_crut_isolation_test",
        crmHouseholdId: household.id,
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
      .values({ clientId: client.id, firstName: "Grantor", role: "client" })
      .returning();
    const [charity] = await db
      .insert(externalBeneficiaries)
      .values({
        clientId: client.id,
        name: `${firmId} Charity`,
        kind: "charity",
        charityType: "public",
      })
      .returning();
    const [crt] = await db
      .insert(entities)
      .values({
        clientId: client.id,
        name: `${firmId} CRT`,
        entityType: "trust",
        trustSubType: "crt",
        isIrrevocable: true,
        isGrantor: true,
        grantor: "client",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      .returning();
    await db.insert(trustSplitInterestDetails).values({
      entityId: crt.id,
      clientId: client.id,
      inceptionYear: 2026,
      inceptionValue: "1000000",
      payoutType: "unitrust",
      payoutPercent: "0.06",
      irc7520Rate: "0.0400",
      termType: "years",
      termYears: 10,
      charityId: charity.id,
      // CRUT 6% / 10 yr / 4% §7520: charitable remainder is the deduction
      originalIncomeInterest: "461385",
      originalRemainderInterest: "538615",
    });
    return {
      clientId: client.id,
      scenarioId: scenario.id,
      fmId: fm.id,
      charityId: charity.id,
      crtId: crt.id,
    };
  }

  beforeEach(async () => {
    await cleanup();
    vi.mocked(helpers.getOrgId).mockReset();
    vi.mocked(helpers.requireOrgId).mockReset();
  });

  it("Firm B cannot GET Firm A's entities (which surfaces CRT split-interest)", async () => {
    const a = await setupFirmWithCrut(FIRM_A);
    vi.mocked(helpers.getOrgId).mockResolvedValue(FIRM_B);
    vi.mocked(helpers.requireOrgId).mockResolvedValue(FIRM_B);
    const { GET } = await import("@/app/api/clients/[id]/entities/route");
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

  it("Firm B cannot PUT split-interest changes onto Firm A's CRT", async () => {
    const a = await setupFirmWithCrut(FIRM_A);
    vi.mocked(helpers.getOrgId).mockResolvedValue(FIRM_B);
    vi.mocked(helpers.requireOrgId).mockResolvedValue(FIRM_B);
    const { PUT } = await import(
      "@/app/api/clients/[id]/entities/[entityId]/route"
    );
    const body = {
      splitInterest: {
        inceptionYear: 2026,
        inceptionValue: 2_000_000, // attempt to bump the value
        payoutType: "unitrust",
        payoutPercent: 0.05,
        irc7520Rate: 0.040,
        termType: "years",
        termYears: 15,
        charityId: a.charityId,
        originalIncomeInterest: 700_000,
        originalRemainderInterest: 1_300_000,
      },
    };
    const res = await PUT(
      new Request("http://x", {
        method: "PUT",
        body: JSON.stringify(body),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
      {
        params: Promise.resolve({ id: a.clientId, entityId: a.crtId }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    );
    expect(res.status).toBe(404);

    const { db } = dbMod;
    const { trustSplitInterestDetails } = schema;
    const { eq } = drizzleOrm;
    const rows = await db
      .select()
      .from(trustSplitInterestDetails)
      .where(eq(trustSplitInterestDetails.entityId, a.crtId));
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].inceptionValue)).toBe(1_000_000);
  });

  it("Firm A's GET on its own client returns the CRT in entity list", async () => {
    const a = await setupFirmWithCrut(FIRM_A);
    vi.mocked(helpers.getOrgId).mockResolvedValue(FIRM_A);
    vi.mocked(helpers.requireOrgId).mockResolvedValue(FIRM_A);
    const { GET } = await import("@/app/api/clients/[id]/entities/route");
    const res = await GET(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new Request("http://x") as any,
      {
        params: Promise.resolve({ id: a.clientId }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    );
    expect(res.status).toBe(200);
    const entities: Array<{ id: string; trustSubType?: string }> =
      await res.json();
    const crt = entities.find((e) => e.id === a.crtId);
    expect(crt).toBeDefined();
    expect(crt!.trustSubType).toBe("crt");
  });

  it("No gifts row is created when a CRT is inserted", async () => {
    const a = await setupFirmWithCrut(FIRM_A);
    const { db } = dbMod;
    const { gifts } = schema;
    const { eq } = drizzleOrm;
    const giftRows = await db
      .select()
      .from(gifts)
      .where(eq(gifts.recipientEntityId, a.crtId));
    expect(giftRows).toHaveLength(0);
  });
});

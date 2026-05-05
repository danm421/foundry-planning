/**
 * Behavioral tenant-isolation test for the reports CRUD routes (Task 3
 * of the foundry-reports-v1 plan). Drives the route handlers directly
 * against the real DB via Drizzle, mocking `requireOrgId` to flip
 * between two firms. Requires DATABASE_URL.
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

// Our routes call `requireOrgId` (strict variant). Mock that, but keep
// the rest of the module (`getOrgId`, `UnauthorizedError`) intact so
// `authErrorResponse` still recognises thrown errors.
vi.mock("@/lib/db-helpers", async (orig) => {
  const actual = await orig<typeof import("@/lib/db-helpers")>();
  return { ...actual, requireOrgId: vi.fn() };
});

// POST pulls `userId` from `auth()` for the `createdByUserId` column.
// We don't need a real Clerk session — a non-null userId is enough.
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({
    userId: "user_reports_test",
    orgId: "firm_reports_test",
  })),
}));

const FIRM_A = "firm_reports_test_a";
const FIRM_B = "firm_reports_test_b";

d("reports tenant isolation", () => {
  let dbMod: typeof import("@/db");
  let schema: typeof import("@/db/schema");
  let helpers: typeof import("@/lib/db-helpers");
  let drizzleOrm: typeof import("drizzle-orm");
  let listRoute: typeof import("@/app/api/clients/[id]/reports/route");
  let itemRoute: typeof import("@/app/api/clients/[id]/reports/[reportId]/route");

  beforeAll(async () => {
    dbMod = await import("@/db");
    schema = await import("@/db/schema");
    helpers = await import("@/lib/db-helpers");
    drizzleOrm = await import("drizzle-orm");
    listRoute = await import("@/app/api/clients/[id]/reports/route");
    itemRoute = await import("@/app/api/clients/[id]/reports/[reportId]/route");
  });

  async function cleanup() {
    const { db } = dbMod;
    const { clients, reports } = schema;
    const { inArray } = drizzleOrm;
    const testClients = await db
      .select({ id: clients.id })
      .from(clients)
      .where(inArray(clients.firmId, [FIRM_A, FIRM_B]));
    const ids = testClients.map((c) => c.id);
    if (ids.length === 0) return;
    await db.delete(reports).where(inArray(reports.clientId, ids));
    await db.delete(clients).where(inArray(clients.firmId, [FIRM_A, FIRM_B]));
  }

  async function setupClient(firmId: string): Promise<string> {
    const { db } = dbMod;
    const { clients } = schema;
    const [client] = await db
      .insert(clients)
      .values({
        firmId,
        advisorId: "advisor_reports_test",
        firstName: "Test",
        lastName: firmId,
        dateOfBirth: "1970-01-01",
        retirementAge: 65,
        planEndAge: 90,
        lifeExpectancy: 90,
        filingStatus: "married_joint",
      })
      .returning();
    return client.id;
  }

  function setRequireOrgId(firmId: string) {
    (helpers.requireOrgId as ReturnType<typeof vi.fn>).mockResolvedValue(
      firmId,
    );
  }

  beforeEach(async () => {
    await cleanup();
    (helpers.requireOrgId as ReturnType<typeof vi.fn>).mockReset();
  });

  async function createReport(clientId: string, title = "Test Report") {
    const res = await listRoute.POST(
      new Request("http://x", {
        method: "POST",
        body: JSON.stringify({ template: "blank", title }),
      }) as unknown as Parameters<typeof listRoute.POST>[0],
      {
        params: Promise.resolve({ id: clientId }),
      } as unknown as Parameters<typeof listRoute.POST>[1],
    );
    return res;
  }

  it("Firm B cannot GET Firm A's reports list", async () => {
    const aClient = await setupClient(FIRM_A);
    setRequireOrgId(FIRM_A);
    const created = await createReport(aClient);
    expect(created.status).toBe(201);

    setRequireOrgId(FIRM_B);
    const seen = await listRoute.GET(
      new Request("http://x") as unknown as Parameters<typeof listRoute.GET>[0],
      {
        params: Promise.resolve({ id: aClient }),
      } as unknown as Parameters<typeof listRoute.GET>[1],
    );
    expect(seen.status).toBe(404);
  });

  it("Firm B cannot GET Firm A's report by id", async () => {
    const aClient = await setupClient(FIRM_A);
    setRequireOrgId(FIRM_A);
    const created = await createReport(aClient);
    expect(created.status).toBe(201);
    const { report } = (await created.json()) as {
      report: { id: string };
    };

    setRequireOrgId(FIRM_B);
    // Use Firm B's own client to make the gate pass on the id segment;
    // the report still belongs to Firm A so we expect 404.
    const bClient = await setupClient(FIRM_B);
    const res = await itemRoute.GET(
      new Request("http://x") as unknown as Parameters<typeof itemRoute.GET>[0],
      {
        params: Promise.resolve({ id: bClient, reportId: report.id }),
      } as unknown as Parameters<typeof itemRoute.GET>[1],
    );
    expect(res.status).toBe(404);
  });

  it("Firm B cannot PATCH Firm A's report", async () => {
    const aClient = await setupClient(FIRM_A);
    setRequireOrgId(FIRM_A);
    const created = await createReport(aClient);
    expect(created.status).toBe(201);
    const { report } = (await created.json()) as {
      report: { id: string };
    };

    setRequireOrgId(FIRM_B);
    const bClient = await setupClient(FIRM_B);
    const res = await itemRoute.PATCH(
      new Request("http://x", {
        method: "PATCH",
        body: JSON.stringify({ title: "Hacked" }),
      }) as unknown as Parameters<typeof itemRoute.PATCH>[0],
      {
        params: Promise.resolve({ id: bClient, reportId: report.id }),
      } as unknown as Parameters<typeof itemRoute.PATCH>[1],
    );
    expect(res.status).toBe(404);

    // And confirm the row didn't actually move.
    const { db } = dbMod;
    const { reports } = schema;
    const { eq } = drizzleOrm;
    const [row] = await db
      .select()
      .from(reports)
      .where(eq(reports.id, report.id));
    expect(row.title).toBe("Test Report");
    expect(row.firmId).toBe(FIRM_A);
  });

  it("Firm B cannot DELETE Firm A's report", async () => {
    const aClient = await setupClient(FIRM_A);
    setRequireOrgId(FIRM_A);
    const created = await createReport(aClient);
    expect(created.status).toBe(201);
    const { report } = (await created.json()) as {
      report: { id: string };
    };

    setRequireOrgId(FIRM_B);
    const bClient = await setupClient(FIRM_B);
    const res = await itemRoute.DELETE(
      new Request("http://x", {
        method: "DELETE",
      }) as unknown as Parameters<typeof itemRoute.DELETE>[0],
      {
        params: Promise.resolve({ id: bClient, reportId: report.id }),
      } as unknown as Parameters<typeof itemRoute.DELETE>[1],
    );
    expect(res.status).toBe(404);

    // And confirm the row still exists.
    const { db } = dbMod;
    const { reports } = schema;
    const { eq } = drizzleOrm;
    const [row] = await db
      .select()
      .from(reports)
      .where(eq(reports.id, report.id));
    expect(row).toBeDefined();
  });

  it("POST template=blank returns 201 with empty pages and null templateKey", async () => {
    const aClient = await setupClient(FIRM_A);
    setRequireOrgId(FIRM_A);

    const res = await createReport(aClient, "Blank One");
    expect(res.status).toBe(201);

    const { report } = (await res.json()) as {
      report: {
        id: string;
        title: string;
        templateKey: string | null;
        pages: unknown[];
        firmId: string;
        clientId: string;
      };
    };

    // UUID v4-ish — Postgres gen_random_uuid() output. We just need a
    // sanity check that we got a real id, not a stub.
    expect(report.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(report.title).toBe("Blank One");
    expect(report.templateKey).toBeNull();
    expect(Array.isArray(report.pages)).toBe(true);
    expect(report.pages.length).toBe(0);
    expect(report.firmId).toBe(FIRM_A);
    expect(report.clientId).toBe(aClient);
  });
});

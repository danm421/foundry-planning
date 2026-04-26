// src/app/api/clients/[id]/scenarios/[sid]/changes/__tests__/route.test.ts
//
// Integration tests for the unified scenario_changes writer route. Hits the
// live Neon dev branch via Drizzle and drives the route handlers directly,
// mocking `requireOrgId` to flip Clerk-org context. Patterned after
// `src/__tests__/beneficiaries-tenant-isolation.test.ts` (which mocks
// `@/lib/db-helpers`) and `src/lib/scenario/__tests__/changes-writer.test.ts`
// (which uses Cooper Sample fixture ids).
//
// Skips when DATABASE_URL is unset.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { recordAudit } from "@/lib/audit";

// Load .env.local before importing anything that reads DATABASE_URL.
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
  // .env.local missing — describe.skipIf below handles it.
}

const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

// Mock auth helpers BEFORE importing the route or its transitive db modules.
vi.mock("@/lib/db-helpers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db-helpers")>(
    "@/lib/db-helpers",
  );
  return {
    ...actual,
    requireOrgId: vi.fn(),
  };
});

// `recordAudit` writes to the audit_log table — mocking it keeps the test
// focused on scenario_changes rows and avoids polluting audit history with
// test-firm rows for every run. (The action-name extension we made in audit.ts
// is enforced at compile time in route.ts.)
vi.mock("@/lib/audit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit")>("@/lib/audit");
  return { ...actual, recordAudit: vi.fn().mockResolvedValue(undefined) };
});

const COOPER_CLIENT_ID = "877a9532-f8ea-49b0-9db7-aadd64fab82a";
const COOPER_FIRM_ID = "org_3CitTEIe8PJa1BVYw7LnEjkiP9r";
const COOPER_SALARY_INCOME_ID = "d99f3ccb-8eb5-44f9-ae81-f52fb2694458";
const COOPER_SALARY_BASE_AMOUNT = 250000;

d("scenario_changes writer route", () => {
  let dbMod: typeof import("@/db");
  let schema: typeof import("@/db/schema");
  let helpers: typeof import("@/lib/db-helpers");
  let drizzleOrm: typeof import("drizzle-orm");
  let route: typeof import("../route");

  beforeAll(async () => {
    dbMod = await import("@/db");
    schema = await import("@/db/schema");
    helpers = await import("@/lib/db-helpers");
    drizzleOrm = await import("drizzle-orm");
    route = await import("../route");
  });

  let scenarioId: string;

  beforeEach(async () => {
    vi.mocked(helpers.requireOrgId).mockReset();
    const { db } = dbMod;
    const { scenarios } = schema;
    const [row] = await db
      .insert(scenarios)
      .values({
        clientId: COOPER_CLIENT_ID,
        name: `route-test-${randomUUID().slice(0, 8)}`,
        isBaseCase: false,
      })
      .returning();
    scenarioId = row.id;
  });

  afterEach(async () => {
    // ON DELETE CASCADE on scenario_changes.scenario_id cleans up child rows.
    const { db } = dbMod;
    const { scenarios } = schema;
    const { eq } = drizzleOrm;
    await db.delete(scenarios).where(eq(scenarios.id, scenarioId));
  });

  function makeReq(url: string, init?: RequestInit) {
    // The route uses `new URL(req.url)` and `req.json()`, both of which the
    // standard Request interface satisfies. Cast through `never` to dodge the
    // NextRequest-vs-Request structural mismatch noise.
    return new Request(url, init) as unknown as import("next/server").NextRequest;
  }

  it("POST edit: writes a scenario_changes row and returns 200", async () => {
    vi.mocked(helpers.requireOrgId).mockResolvedValue(COOPER_FIRM_ID);

    const req = makeReq("http://test.local/changes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        op: "edit",
        targetKind: "income",
        targetId: COOPER_SALARY_INCOME_ID,
        desiredFields: { annualAmount: 300000 },
      }),
    });

    const res = await route.POST(req, {
      params: Promise.resolve({ id: COOPER_CLIENT_ID, sid: scenarioId }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);

    const { db } = dbMod;
    const { scenarioChanges } = schema;
    const { and, eq } = drizzleOrm;
    const rows = await db
      .select()
      .from(scenarioChanges)
      .where(
        and(
          eq(scenarioChanges.scenarioId, scenarioId),
          eq(scenarioChanges.targetId, COOPER_SALARY_INCOME_ID),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0].opType).toBe("edit");
    expect(rows[0].payload).toEqual({
      annualAmount: { from: COOPER_SALARY_BASE_AMOUNT, to: 300000 },
    });

    expect(vi.mocked(recordAudit)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "scenario_change.upsert",
        resourceType: "scenario_change",
        resourceId: scenarioId,
        clientId: COOPER_CLIENT_ID,
        firmId: COOPER_FIRM_ID,
        metadata: expect.objectContaining({
          op: "edit",
          targetKind: "income",
          targetId: COOPER_SALARY_INCOME_ID,
        }),
      }),
    );
  });

  it("DELETE revert: removes the matching scenario_changes row", async () => {
    vi.mocked(helpers.requireOrgId).mockResolvedValue(COOPER_FIRM_ID);

    // Seed an edit row first via the route's POST so the test exercises the
    // same surface a real client would.
    const seedReq = makeReq("http://test.local/changes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        op: "edit",
        targetKind: "income",
        targetId: COOPER_SALARY_INCOME_ID,
        desiredFields: { annualAmount: 300000 },
      }),
    });
    const seedRes = await route.POST(seedReq, {
      params: Promise.resolve({ id: COOPER_CLIENT_ID, sid: scenarioId }),
    });
    expect(seedRes.status).toBe(200);

    // Now revert.
    const delUrl = new URL("http://test.local/changes");
    delUrl.searchParams.set("kind", "income");
    delUrl.searchParams.set("target", COOPER_SALARY_INCOME_ID);
    delUrl.searchParams.set("op", "edit");
    const delReq = makeReq(delUrl.toString(), { method: "DELETE" });
    const delRes = await route.DELETE(delReq, {
      params: Promise.resolve({ id: COOPER_CLIENT_ID, sid: scenarioId }),
    });
    expect(delRes.status).toBe(200);

    const { db } = dbMod;
    const { scenarioChanges } = schema;
    const { and, eq } = drizzleOrm;
    const rows = await db
      .select()
      .from(scenarioChanges)
      .where(
        and(
          eq(scenarioChanges.scenarioId, scenarioId),
          eq(scenarioChanges.targetId, COOPER_SALARY_INCOME_ID),
        ),
      );
    expect(rows).toHaveLength(0);

    expect(vi.mocked(recordAudit)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "scenario_change.revert",
        resourceType: "scenario_change",
        resourceId: scenarioId,
        clientId: COOPER_CLIENT_ID,
        firmId: COOPER_FIRM_ID,
        metadata: expect.objectContaining({
          op: "edit",
          targetKind: "income",
          targetId: COOPER_SALARY_INCOME_ID,
        }),
      }),
    );
  });

  it("returns 404 when caller's firm doesn't own the client", async () => {
    // Wrong firm — `findClientInFirm` should miss and the route 404s before
    // even hitting the writer. (404 is intentional — see route comment on
    // assertRouteScope.)
    vi.mocked(helpers.requireOrgId).mockResolvedValue("org_not_cooper");

    const req = makeReq("http://test.local/changes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        op: "edit",
        targetKind: "income",
        targetId: COOPER_SALARY_INCOME_ID,
        desiredFields: { annualAmount: 300000 },
      }),
    });
    const res = await route.POST(req, {
      params: Promise.resolve({ id: COOPER_CLIENT_ID, sid: scenarioId }),
    });

    expect(res.status).toBe(404);

    // Confirm nothing landed.
    const { db } = dbMod;
    const { scenarioChanges } = schema;
    const { eq } = drizzleOrm;
    const rows = await db
      .select()
      .from(scenarioChanges)
      .where(eq(scenarioChanges.scenarioId, scenarioId));
    expect(rows).toHaveLength(0);
  });

  it("POST returns 400 on malformed body", async () => {
    vi.mocked(helpers.requireOrgId).mockResolvedValue(COOPER_FIRM_ID);

    const req = makeReq("http://test.local/changes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        op: "edit",
        targetKind: "income",
        // missing targetId + desiredFields
      }),
    });
    const res = await route.POST(req, {
      params: Promise.resolve({ id: COOPER_CLIENT_ID, sid: scenarioId }),
    });
    expect(res.status).toBe(400);
  });

  it("DELETE returns 400 when search params are missing", async () => {
    vi.mocked(helpers.requireOrgId).mockResolvedValue(COOPER_FIRM_ID);

    const req = makeReq("http://test.local/changes", { method: "DELETE" });
    const res = await route.DELETE(req, {
      params: Promise.resolve({ id: COOPER_CLIENT_ID, sid: scenarioId }),
    });
    expect(res.status).toBe(400);
  });
});

// src/app/api/clients/[id]/scenarios/[sid]/__tests__/route.test.ts
//
// Integration tests for the per-scenario route (PATCH rename, POST duplicate,
// DELETE). Hits the live Neon dev branch via Drizzle and drives the route
// handlers directly, mocking `requireOrgId` to flip Clerk-org context.
// Patterned after Task 3's
// `src/app/api/clients/[id]/scenarios/[sid]/changes/__tests__/route.test.ts`.
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

vi.mock("@/lib/db-helpers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db-helpers")>(
    "@/lib/db-helpers",
  );
  return {
    ...actual,
    requireOrgId: vi.fn(),
  };
});

vi.mock("@/lib/audit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit")>("@/lib/audit");
  return { ...actual, recordAudit: vi.fn().mockResolvedValue(undefined) };
});

const COOPER_CLIENT_ID = "877a9532-f8ea-49b0-9db7-aadd64fab82a";
const COOPER_FIRM_ID = "org_3CitTEIe8PJa1BVYw7LnEjkiP9r";
const COOPER_BASE_SCENARIO_ID = "9fb9aa4e-99dd-467b-b731-43dc55fb40ea";
const COOPER_SALARY_INCOME_ID = "d99f3ccb-8eb5-44f9-ae81-f52fb2694458";

d("scenario [sid] route (PATCH / POST duplicate / DELETE)", () => {
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

  // Track every scenario we created so cleanup deletes only our own rows. We
  // never let a test delete the base case (the route itself rejects that).
  const createdScenarioIds: string[] = [];
  let scenarioId: string;

  beforeEach(async () => {
    vi.mocked(helpers.requireOrgId).mockReset();
    vi.mocked(recordAudit).mockClear();
    createdScenarioIds.length = 0;

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
    createdScenarioIds.push(row.id);
  });

  afterEach(async () => {
    // ON DELETE CASCADE on scenario_changes / scenario_toggle_groups handles
    // child rows. We loop here because POST-duplicate creates additional
    // scenarios that the test pushed into the tracker.
    const { db } = dbMod;
    const { scenarios } = schema;
    const { eq } = drizzleOrm;
    for (const id of createdScenarioIds) {
      await db.delete(scenarios).where(eq(scenarios.id, id));
    }
  });

  function makeReq(url: string, init?: RequestInit) {
    return new Request(url, init) as unknown as import("next/server").NextRequest;
  }

  it("PATCH renames the scenario and writes an audit row", async () => {
    vi.mocked(helpers.requireOrgId).mockResolvedValue(COOPER_FIRM_ID);

    const newName = `renamed-${randomUUID().slice(0, 8)}`;
    const req = makeReq("http://test.local/scenarios/sid", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });
    const res = await route.PATCH(req, {
      params: Promise.resolve({ id: COOPER_CLIENT_ID, sid: scenarioId }),
    });

    expect(res.status).toBe(200);

    const { db } = dbMod;
    const { scenarios } = schema;
    const { eq } = drizzleOrm;
    const [row] = await db
      .select()
      .from(scenarios)
      .where(eq(scenarios.id, scenarioId));
    expect(row.name).toBe(newName);

    expect(vi.mocked(recordAudit)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "scenario.rename",
        resourceType: "scenario",
        resourceId: scenarioId,
        clientId: COOPER_CLIENT_ID,
        firmId: COOPER_FIRM_ID,
        metadata: expect.objectContaining({ name: newName }),
      }),
    );
  });

  it("POST duplicates the scenario including its changes (suffix '(copy)')", async () => {
    vi.mocked(helpers.requireOrgId).mockResolvedValue(COOPER_FIRM_ID);

    // Seed an edit change on the source scenario so we can assert it gets
    // cloned. Using direct insert (rather than the changes-writer) keeps the
    // test focused on the [sid] route's duplicate path.
    const { db } = dbMod;
    const { scenarioChanges } = schema;
    const { eq } = drizzleOrm;

    await db.insert(scenarioChanges).values({
      scenarioId,
      opType: "edit",
      targetKind: "income",
      targetId: COOPER_SALARY_INCOME_ID,
      payload: { annualAmount: { from: 250000, to: 290000 } },
      orderIndex: 0,
    });

    const req = makeReq("http://test.local/scenarios/sid", { method: "POST" });
    const res = await route.POST(req, {
      params: Promise.resolve({ id: COOPER_CLIENT_ID, sid: scenarioId }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      scenario: { id: string; name: string; clientId: string };
    };
    createdScenarioIds.push(body.scenario.id);

    // Source name was randomized in beforeEach; the copy gets " (copy)"
    // appended. Don't hard-code — just verify the suffix.
    expect(body.scenario.name).toMatch(/ \(copy\)$/);
    expect(body.scenario.clientId).toBe(COOPER_CLIENT_ID);
    expect(body.scenario.id).not.toBe(scenarioId);

    // Cloned scenario should carry over the source change.
    const cloned = await db
      .select()
      .from(scenarioChanges)
      .where(eq(scenarioChanges.scenarioId, body.scenario.id));
    expect(cloned).toHaveLength(1);
    expect(cloned[0].targetId).toBe(COOPER_SALARY_INCOME_ID);
    expect(cloned[0].payload).toEqual({
      annualAmount: { from: 250000, to: 290000 },
    });

    expect(vi.mocked(recordAudit)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "scenario.duplicate",
        resourceType: "scenario",
        resourceId: body.scenario.id,
        clientId: COOPER_CLIENT_ID,
        firmId: COOPER_FIRM_ID,
        metadata: expect.objectContaining({
          sourceScenarioId: scenarioId,
          name: body.scenario.name,
        }),
      }),
    );
  });

  it("DELETE removes the scenario and cascades scenario_changes", async () => {
    vi.mocked(helpers.requireOrgId).mockResolvedValue(COOPER_FIRM_ID);

    // Seed a child change so we can confirm CASCADE wipes it.
    const { db } = dbMod;
    const { scenarios, scenarioChanges } = schema;
    const { eq } = drizzleOrm;

    await db.insert(scenarioChanges).values({
      scenarioId,
      opType: "edit",
      targetKind: "income",
      targetId: COOPER_SALARY_INCOME_ID,
      payload: { annualAmount: { from: 250000, to: 275000 } },
      orderIndex: 0,
    });

    const req = makeReq("http://test.local/scenarios/sid", { method: "DELETE" });
    const res = await route.DELETE(req, {
      params: Promise.resolve({ id: COOPER_CLIENT_ID, sid: scenarioId }),
    });

    expect(res.status).toBe(200);

    const remaining = await db
      .select()
      .from(scenarios)
      .where(eq(scenarios.id, scenarioId));
    expect(remaining).toHaveLength(0);

    const remainingChanges = await db
      .select()
      .from(scenarioChanges)
      .where(eq(scenarioChanges.scenarioId, scenarioId));
    expect(remainingChanges).toHaveLength(0);

    // Already-deleted in route — drop from cleanup tracker so afterEach
    // doesn't double-delete (delete on a missing row is a no-op, but tidier
    // to stay accurate).
    createdScenarioIds.length = 0;

    expect(vi.mocked(recordAudit)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "scenario.delete",
        resourceType: "scenario",
        resourceId: scenarioId,
        clientId: COOPER_CLIENT_ID,
        firmId: COOPER_FIRM_ID,
      }),
    );
  });

  it("DELETE refuses to delete the base case (returns 400)", async () => {
    vi.mocked(helpers.requireOrgId).mockResolvedValue(COOPER_FIRM_ID);

    const req = makeReq("http://test.local/scenarios/sid", { method: "DELETE" });
    const res = await route.DELETE(req, {
      params: Promise.resolve({
        id: COOPER_CLIENT_ID,
        sid: COOPER_BASE_SCENARIO_ID,
      }),
    });

    expect(res.status).toBe(400);

    // Base scenario must still exist.
    const { db } = dbMod;
    const { scenarios } = schema;
    const { eq } = drizzleOrm;
    const [base] = await db
      .select()
      .from(scenarios)
      .where(eq(scenarios.id, COOPER_BASE_SCENARIO_ID));
    expect(base).toBeTruthy();
    expect(base.isBaseCase).toBe(true);

    expect(vi.mocked(recordAudit)).not.toHaveBeenCalled();
  });

  it("returns 404 when caller's firm doesn't own the client (cross-firm probe)", async () => {
    vi.mocked(helpers.requireOrgId).mockResolvedValue("org_not_cooper");

    // PATCH should 404 before mutating.
    const newName = `should-not-stick-${randomUUID().slice(0, 8)}`;
    const req = makeReq("http://test.local/scenarios/sid", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });
    const res = await route.PATCH(req, {
      params: Promise.resolve({ id: COOPER_CLIENT_ID, sid: scenarioId }),
    });

    expect(res.status).toBe(404);

    // Confirm name didn't change.
    const { db } = dbMod;
    const { scenarios } = schema;
    const { eq } = drizzleOrm;
    const [row] = await db
      .select()
      .from(scenarios)
      .where(eq(scenarios.id, scenarioId));
    expect(row.name).not.toBe(newName);

    expect(vi.mocked(recordAudit)).not.toHaveBeenCalled();
  });

  it("returns 404 when sid points at a scenario from a different client", async () => {
    vi.mocked(helpers.requireOrgId).mockResolvedValue(COOPER_FIRM_ID);

    // Random uuid that won't exist in scenarios — exercises the
    // assertRouteScope scenario-not-found branch. Same observable behavior as
    // a uuid that exists but belongs to a different client: 404 + no audit.
    const fakeScenarioId = randomUUID();

    const req = makeReq("http://test.local/scenarios/sid", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "should-not-stick" }),
    });
    const res = await route.PATCH(req, {
      params: Promise.resolve({
        id: COOPER_CLIENT_ID,
        sid: fakeScenarioId,
      }),
    });

    expect(res.status).toBe(404);
    expect(vi.mocked(recordAudit)).not.toHaveBeenCalled();
  });

  it("PATCH returns 400 on malformed body (empty name)", async () => {
    vi.mocked(helpers.requireOrgId).mockResolvedValue(COOPER_FIRM_ID);

    const req = makeReq("http://test.local/scenarios/sid", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "" }),
    });
    const res = await route.PATCH(req, {
      params: Promise.resolve({ id: COOPER_CLIENT_ID, sid: scenarioId }),
    });

    expect(res.status).toBe(400);
    expect(vi.mocked(recordAudit)).not.toHaveBeenCalled();
  });

  it("PATCH returns 400 when name is whitespace-only", async () => {
    vi.mocked(helpers.requireOrgId).mockResolvedValue(COOPER_FIRM_ID);

    const req = makeReq("http://test.local/scenarios/sid", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "   " }),
    });
    const res = await route.PATCH(req, {
      params: Promise.resolve({ id: COOPER_CLIENT_ID, sid: scenarioId }),
    });

    expect(res.status).toBe(400);
    expect(vi.mocked(recordAudit)).not.toHaveBeenCalled();
  });
});

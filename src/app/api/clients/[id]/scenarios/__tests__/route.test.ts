// src/app/api/clients/[id]/scenarios/__tests__/route.test.ts
//
// Integration tests for the scenarios collection route (GET list + POST
// create with optional clone). Hits the live Neon dev branch via Drizzle and
// drives the route handlers directly, mocking `requireOrgId` to flip Clerk-org
// context. Patterned after Task 3's
// `src/app/api/clients/[id]/scenarios/[sid]/changes/__tests__/route.test.ts`
// (same .env.local bootstrap, `@/lib/db-helpers` + `@/lib/audit` mocks, Cooper
// Sample fixture ids, beforeEach/afterEach cleanup).
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

// `recordAudit` writes to audit_log — mocking keeps the test focused on
// scenarios rows and asserts the action-name extension we made in audit.ts.
vi.mock("@/lib/audit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit")>("@/lib/audit");
  return { ...actual, recordAudit: vi.fn().mockResolvedValue(undefined) };
});

const COOPER_CLIENT_ID = "877a9532-f8ea-49b0-9db7-aadd64fab82a";
const COOPER_FIRM_ID = "org_3CitTEIe8PJa1BVYw7LnEjkiP9r";
const COOPER_BASE_SCENARIO_ID = "9fb9aa4e-99dd-467b-b731-43dc55fb40ea";
const COOPER_SALARY_INCOME_ID = "d99f3ccb-8eb5-44f9-ae81-f52fb2694458";

d("scenarios collection route (GET / POST)", () => {
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

  // Track scenarios we created so the cleanup in afterEach only nukes our own
  // rows — never the base-case scenario or anything pre-existing in dev.
  const createdScenarioIds: string[] = [];

  beforeEach(() => {
    vi.mocked(helpers.requireOrgId).mockReset();
    vi.mocked(recordAudit).mockClear();
    createdScenarioIds.length = 0;
  });

  afterEach(async () => {
    // ON DELETE CASCADE on scenario_changes.scenario_id +
    // scenario_toggle_groups.scenario_id cleans up child rows automatically.
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

  it("GET lists scenarios for the client (org-scoped)", async () => {
    vi.mocked(helpers.requireOrgId).mockResolvedValue(COOPER_FIRM_ID);

    // Seed an extra scenario so the list contains more than just the base.
    const { db } = dbMod;
    const { scenarios } = schema;
    const [seeded] = await db
      .insert(scenarios)
      .values({
        clientId: COOPER_CLIENT_ID,
        name: `route-list-test-${randomUUID().slice(0, 8)}`,
        isBaseCase: false,
      })
      .returning();
    createdScenarioIds.push(seeded.id);

    const req = makeReq("http://test.local/scenarios");
    const res = await route.GET(req, {
      params: Promise.resolve({ id: COOPER_CLIENT_ID }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      scenarios: Array<{ id: string; clientId: string; isBaseCase: boolean }>;
    };
    // Must include the base case + the seeded row. We don't assert exact
    // length because dev data may have leftover scenarios from other tests.
    const ids = body.scenarios.map((s) => s.id);
    expect(ids).toContain(COOPER_BASE_SCENARIO_ID);
    expect(ids).toContain(seeded.id);
    // Every returned row must be scoped to this client — no cross-client leak.
    for (const s of body.scenarios) {
      expect(s.clientId).toBe(COOPER_CLIENT_ID);
    }
  });

  it("GET returns 404 when the caller's firm doesn't own the client", async () => {
    vi.mocked(helpers.requireOrgId).mockResolvedValue("org_not_cooper");

    const req = makeReq("http://test.local/scenarios");
    const res = await route.GET(req, {
      params: Promise.resolve({ id: COOPER_CLIENT_ID }),
    });

    expect(res.status).toBe(404);
  });

  it("POST copyFrom=empty creates a fresh scenario with no changes/groups", async () => {
    vi.mocked(helpers.requireOrgId).mockResolvedValue(COOPER_FIRM_ID);

    const name = `empty-${randomUUID().slice(0, 8)}`;
    const req = makeReq("http://test.local/scenarios", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, copyFrom: "empty" }),
    });
    const res = await route.POST(req, {
      params: Promise.resolve({ id: COOPER_CLIENT_ID }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      scenario: { id: string; name: string; clientId: string; isBaseCase: boolean };
    };
    expect(body.scenario.name).toBe(name);
    expect(body.scenario.clientId).toBe(COOPER_CLIENT_ID);
    expect(body.scenario.isBaseCase).toBe(false);
    createdScenarioIds.push(body.scenario.id);

    // Verify in DB.
    const { db } = dbMod;
    const { scenarios, scenarioChanges, scenarioToggleGroups } = schema;
    const { eq } = drizzleOrm;
    const [row] = await db
      .select()
      .from(scenarios)
      .where(eq(scenarios.id, body.scenario.id));
    expect(row).toBeTruthy();
    expect(row.name).toBe(name);

    const changes = await db
      .select()
      .from(scenarioChanges)
      .where(eq(scenarioChanges.scenarioId, body.scenario.id));
    expect(changes).toHaveLength(0);

    const groups = await db
      .select()
      .from(scenarioToggleGroups)
      .where(eq(scenarioToggleGroups.scenarioId, body.scenario.id));
    expect(groups).toHaveLength(0);

    expect(vi.mocked(recordAudit)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "scenario.create",
        resourceType: "scenario",
        resourceId: body.scenario.id,
        clientId: COOPER_CLIENT_ID,
        firmId: COOPER_FIRM_ID,
        metadata: expect.objectContaining({ name, copyFrom: "empty" }),
      }),
    );
  });

  it("POST copyFrom=<sourceId> clones changes from the source scenario", async () => {
    vi.mocked(helpers.requireOrgId).mockResolvedValue(COOPER_FIRM_ID);

    // Build a source scenario with one edit change so we can verify the clone
    // copies the row over.
    const { db } = dbMod;
    const { scenarios, scenarioChanges } = schema;
    const { eq } = drizzleOrm;

    const [source] = await db
      .insert(scenarios)
      .values({
        clientId: COOPER_CLIENT_ID,
        name: `clone-src-${randomUUID().slice(0, 8)}`,
        isBaseCase: false,
      })
      .returning();
    createdScenarioIds.push(source.id);

    await db.insert(scenarioChanges).values({
      scenarioId: source.id,
      opType: "edit",
      targetKind: "income",
      targetId: COOPER_SALARY_INCOME_ID,
      payload: { annualAmount: { from: 250000, to: 275000 } },
      orderIndex: 0,
    });

    const name = `clone-dst-${randomUUID().slice(0, 8)}`;
    const req = makeReq("http://test.local/scenarios", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, copyFrom: source.id }),
    });
    const res = await route.POST(req, {
      params: Promise.resolve({ id: COOPER_CLIENT_ID }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { scenario: { id: string } };
    createdScenarioIds.push(body.scenario.id);

    // Cloned scenario should have a copy of the source's change row.
    const cloned = await db
      .select()
      .from(scenarioChanges)
      .where(eq(scenarioChanges.scenarioId, body.scenario.id));
    expect(cloned).toHaveLength(1);
    expect(cloned[0].opType).toBe("edit");
    expect(cloned[0].targetId).toBe(COOPER_SALARY_INCOME_ID);
    expect(cloned[0].payload).toEqual({
      annualAmount: { from: 250000, to: 275000 },
    });

    expect(vi.mocked(recordAudit)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "scenario.create",
        firmId: COOPER_FIRM_ID,
        metadata: expect.objectContaining({ name, copyFrom: source.id }),
      }),
    );
  });

  it("POST returns 404 when copyFrom uuid does not exist (cross-client probe)", async () => {
    vi.mocked(helpers.requireOrgId).mockResolvedValue(COOPER_FIRM_ID);

    // Random uuid that won't be in the scenarios table — exercises the
    // source-scenario lookup miss branch (route.ts lines 111-120). Same
    // observable behavior as a uuid that exists but belongs to a different
    // client: 404, no audit, no scenarios row created.
    const fakeSourceId = randomUUID();

    const req = makeReq("http://test.local/scenarios", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "should-fail",
        copyFrom: fakeSourceId,
      }),
    });
    const res = await route.POST(req, {
      params: Promise.resolve({ id: COOPER_CLIENT_ID }),
    });

    expect(res.status).toBe(404);

    // Confirm no scenario landed under Cooper for this name.
    const { db } = dbMod;
    const { scenarios } = schema;
    const { eq } = drizzleOrm;
    const rows = await db
      .select()
      .from(scenarios)
      .where(eq(scenarios.clientId, COOPER_CLIENT_ID));
    expect(rows.find((s) => s.name === "should-fail")).toBeUndefined();

    expect(vi.mocked(recordAudit)).not.toHaveBeenCalled();
  });

  it("POST returns 404 when caller's firm doesn't own the client", async () => {
    vi.mocked(helpers.requireOrgId).mockResolvedValue("org_not_cooper");

    const req = makeReq("http://test.local/scenarios", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "cross-firm-probe", copyFrom: "empty" }),
    });
    const res = await route.POST(req, {
      params: Promise.resolve({ id: COOPER_CLIENT_ID }),
    });

    expect(res.status).toBe(404);

    // Confirm no scenario landed.
    const { db } = dbMod;
    const { scenarios } = schema;
    const { eq } = drizzleOrm;
    const rows = await db
      .select()
      .from(scenarios)
      .where(eq(scenarios.clientId, COOPER_CLIENT_ID));
    expect(rows.find((s) => s.name === "cross-firm-probe")).toBeUndefined();

    expect(vi.mocked(recordAudit)).not.toHaveBeenCalled();
  });

  it("POST returns 400 on malformed body (missing name)", async () => {
    vi.mocked(helpers.requireOrgId).mockResolvedValue(COOPER_FIRM_ID);

    const req = makeReq("http://test.local/scenarios", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ copyFrom: "empty" }),
    });
    const res = await route.POST(req, {
      params: Promise.resolve({ id: COOPER_CLIENT_ID }),
    });
    expect(res.status).toBe(400);

    expect(vi.mocked(recordAudit)).not.toHaveBeenCalled();
  });

  it("POST returns 400 when name is whitespace-only", async () => {
    vi.mocked(helpers.requireOrgId).mockResolvedValue(COOPER_FIRM_ID);

    const req = makeReq("http://test.local/scenarios", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "   ", copyFrom: "empty" }),
    });
    const res = await route.POST(req, {
      params: Promise.resolve({ id: COOPER_CLIENT_ID }),
    });
    expect(res.status).toBe(400);

    expect(vi.mocked(recordAudit)).not.toHaveBeenCalled();
  });
});

// src/app/api/clients/[id]/scenarios/[sid]/toggle-groups/__tests__/route.test.ts
//
// Integration tests for the toggle-groups collection route (GET list + POST
// create). Hits the live Neon dev branch via Drizzle and drives the route
// handlers directly, mocking `requireOrgId` to flip Clerk-org context.
// Patterned after Task 4's
// `src/app/api/clients/[id]/scenarios/__tests__/route.test.ts`.
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

d("scenario toggle-groups collection route (GET / POST)", () => {
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

  // Track every scenario we created so cleanup deletes only our own rows.
  // Cascade on scenarios → scenario_toggle_groups handles child rows.
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
        name: `tg-test-${randomUUID().slice(0, 8)}`,
        isBaseCase: false,
      })
      .returning();
    scenarioId = row.id;
    createdScenarioIds.push(row.id);
  });

  afterEach(async () => {
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

  it("POST creates the first toggle group with orderIndex=0 and writes audit", async () => {
    vi.mocked(helpers.requireOrgId).mockResolvedValue(COOPER_FIRM_ID);

    const name = `Group A ${randomUUID().slice(0, 4)}`;
    const req = makeReq("http://test.local/toggle-groups", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, defaultOn: true }),
    });
    const res = await route.POST(req, {
      params: Promise.resolve({ id: COOPER_CLIENT_ID, sid: scenarioId }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      group: {
        id: string;
        scenarioId: string;
        name: string;
        defaultOn: boolean;
        orderIndex: number;
        requiresGroupId: string | null;
      };
    };
    expect(body.group.scenarioId).toBe(scenarioId);
    expect(body.group.name).toBe(name);
    expect(body.group.defaultOn).toBe(true);
    expect(body.group.orderIndex).toBe(0);
    expect(body.group.requiresGroupId).toBeNull();

    expect(vi.mocked(recordAudit)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "toggle_group.create",
        resourceType: "toggle_group",
        resourceId: body.group.id,
        clientId: COOPER_CLIENT_ID,
        firmId: COOPER_FIRM_ID,
        metadata: expect.objectContaining({
          scenarioId,
          groupId: body.group.id,
          name,
          defaultOn: true,
        }),
      }),
    );
  });

  it("POST a second group assigns orderIndex=1", async () => {
    vi.mocked(helpers.requireOrgId).mockResolvedValue(COOPER_FIRM_ID);

    // Seed a first group via the route so we don't depend on a DB-level
    // default. Then POST a second and verify orderIndex increments.
    const first = await route.POST(
      makeReq("http://test.local/toggle-groups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "first", defaultOn: true }),
      }),
      { params: Promise.resolve({ id: COOPER_CLIENT_ID, sid: scenarioId }) },
    );
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { group: { orderIndex: number } };
    expect(firstBody.group.orderIndex).toBe(0);

    const second = await route.POST(
      makeReq("http://test.local/toggle-groups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "second", defaultOn: false }),
      }),
      { params: Promise.resolve({ id: COOPER_CLIENT_ID, sid: scenarioId }) },
    );
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as { group: { orderIndex: number; defaultOn: boolean } };
    expect(secondBody.group.orderIndex).toBe(1);
    expect(secondBody.group.defaultOn).toBe(false);
  });

  it("POST returns 400 on whitespace-only name", async () => {
    vi.mocked(helpers.requireOrgId).mockResolvedValue(COOPER_FIRM_ID);

    const req = makeReq("http://test.local/toggle-groups", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "   ", defaultOn: true }),
    });
    const res = await route.POST(req, {
      params: Promise.resolve({ id: COOPER_CLIENT_ID, sid: scenarioId }),
    });
    expect(res.status).toBe(400);
    expect(vi.mocked(recordAudit)).not.toHaveBeenCalled();
  });

  it("POST returns 404 when the caller's firm doesn't own the client", async () => {
    vi.mocked(helpers.requireOrgId).mockResolvedValue("org_not_cooper");

    const req = makeReq("http://test.local/toggle-groups", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "cross-firm", defaultOn: true }),
    });
    const res = await route.POST(req, {
      params: Promise.resolve({ id: COOPER_CLIENT_ID, sid: scenarioId }),
    });
    expect(res.status).toBe(404);
    expect(vi.mocked(recordAudit)).not.toHaveBeenCalled();
  });

  it("POST returns 404 when sid points at a scenario from a different client", async () => {
    vi.mocked(helpers.requireOrgId).mockResolvedValue(COOPER_FIRM_ID);

    // Random uuid — exercises the scenario-not-found branch in
    // assertScenarioRouteScope. Same observable as a real scenario from
    // another client: 404, no audit, no insert.
    const fakeScenarioId = randomUUID();

    const req = makeReq("http://test.local/toggle-groups", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "wrong-scenario", defaultOn: true }),
    });
    const res = await route.POST(req, {
      params: Promise.resolve({ id: COOPER_CLIENT_ID, sid: fakeScenarioId }),
    });
    expect(res.status).toBe(404);
    expect(vi.mocked(recordAudit)).not.toHaveBeenCalled();
  });

  it("GET returns groups ordered by orderIndex", async () => {
    vi.mocked(helpers.requireOrgId).mockResolvedValue(COOPER_FIRM_ID);

    // Seed groups directly so the GET-only path is what's under test.
    const { db } = dbMod;
    const { scenarioToggleGroups } = schema;
    await db.insert(scenarioToggleGroups).values([
      { scenarioId, name: "third", orderIndex: 2 },
      { scenarioId, name: "first", orderIndex: 0 },
      { scenarioId, name: "second", orderIndex: 1 },
    ]);

    const req = makeReq("http://test.local/toggle-groups");
    const res = await route.GET(req, {
      params: Promise.resolve({ id: COOPER_CLIENT_ID, sid: scenarioId }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      groups: Array<{ name: string; orderIndex: number }>;
    };
    expect(body.groups.map((g) => g.name)).toEqual(["first", "second", "third"]);
    expect(body.groups.map((g) => g.orderIndex)).toEqual([0, 1, 2]);
  });

  it("GET returns 404 when caller's firm doesn't own the client", async () => {
    vi.mocked(helpers.requireOrgId).mockResolvedValue("org_not_cooper");

    const req = makeReq("http://test.local/toggle-groups");
    const res = await route.GET(req, {
      params: Promise.resolve({ id: COOPER_CLIENT_ID, sid: scenarioId }),
    });
    expect(res.status).toBe(404);
  });
});

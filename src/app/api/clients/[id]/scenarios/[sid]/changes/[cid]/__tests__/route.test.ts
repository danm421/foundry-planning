// src/app/api/clients/[id]/scenarios/[sid]/changes/[cid]/__tests__/route.test.ts
//
// Integration tests for the per-change PATCH route (move a scenario_change in
// or out of a toggle group). Hits the live Neon dev branch via Drizzle and
// drives the route handler directly, mocking `requireOrgId` and `recordAudit`
// like the sibling toggle-groups [gid] tests.
//
// Skips when DATABASE_URL is unset.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { recordAudit } from "@/lib/audit";

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
  return { ...actual, requireOrgId: vi.fn() };
});

vi.mock("@/lib/audit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit")>("@/lib/audit");
  return { ...actual, recordAudit: vi.fn().mockResolvedValue(undefined) };
});

const COOPER_CLIENT_ID = "877a9532-f8ea-49b0-9db7-aadd64fab82a";
const COOPER_FIRM_ID = "org_3CitTEIe8PJa1BVYw7LnEjkiP9r";
const COOPER_SALARY_INCOME_ID = "d99f3ccb-8eb5-44f9-ae81-f52fb2694458";

d("scenario change [cid] route (PATCH)", () => {
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

  const createdScenarioIds: string[] = [];
  let scenarioId: string;
  let groupId: string;
  let changeId: string;

  beforeEach(async () => {
    vi.mocked(helpers.requireOrgId).mockReset();
    vi.mocked(recordAudit).mockClear();
    createdScenarioIds.length = 0;

    const { db } = dbMod;
    const { scenarios, scenarioToggleGroups, scenarioChanges } = schema;
    const [scenarioRow] = await db
      .insert(scenarios)
      .values({
        clientId: COOPER_CLIENT_ID,
        name: `change-cid-test-${randomUUID().slice(0, 8)}`,
        isBaseCase: false,
      })
      .returning();
    scenarioId = scenarioRow.id;
    createdScenarioIds.push(scenarioRow.id);

    const [groupRow] = await db
      .insert(scenarioToggleGroups)
      .values({
        scenarioId,
        name: `g-${randomUUID().slice(0, 6)}`,
        defaultOn: true,
        orderIndex: 0,
      })
      .returning();
    groupId = groupRow.id;

    // Seed an ungrouped change row pointing at Cooper's salary income.
    const [changeRow] = await db
      .insert(scenarioChanges)
      .values({
        scenarioId,
        opType: "edit",
        targetKind: "income",
        targetId: COOPER_SALARY_INCOME_ID,
        payload: { annualAmount: { from: 250000, to: 300000 } },
        toggleGroupId: null,
        orderIndex: 0,
      })
      .returning();
    changeId = changeRow.id;
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

  it("PATCH moves the change into a group, writes audit toggle_group.move_change", async () => {
    vi.mocked(helpers.requireOrgId).mockResolvedValue(COOPER_FIRM_ID);

    const req = makeReq("http://test.local/changes/c", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toggleGroupId: groupId }),
    });
    const res = await route.PATCH(req, {
      params: Promise.resolve({
        id: COOPER_CLIENT_ID,
        sid: scenarioId,
        cid: changeId,
      }),
    });
    expect(res.status).toBe(200);

    const { db } = dbMod;
    const { scenarioChanges } = schema;
    const { eq } = drizzleOrm;
    const [row] = await db
      .select()
      .from(scenarioChanges)
      .where(eq(scenarioChanges.id, changeId));
    expect(row.toggleGroupId).toBe(groupId);

    expect(vi.mocked(recordAudit)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "toggle_group.move_change",
        resourceType: "scenario_change",
        resourceId: changeId,
        clientId: COOPER_CLIENT_ID,
        firmId: COOPER_FIRM_ID,
        metadata: expect.objectContaining({
          scenarioId,
          toggleGroupId: groupId,
        }),
      }),
    );
  });

  it("PATCH with toggleGroupId=null clears the assignment", async () => {
    vi.mocked(helpers.requireOrgId).mockResolvedValue(COOPER_FIRM_ID);

    // First park the change in the group so the null PATCH has something to clear.
    const { db } = dbMod;
    const { scenarioChanges } = schema;
    const { eq } = drizzleOrm;
    await db
      .update(scenarioChanges)
      .set({ toggleGroupId: groupId })
      .where(eq(scenarioChanges.id, changeId));

    const req = makeReq("http://test.local/changes/c", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toggleGroupId: null }),
    });
    const res = await route.PATCH(req, {
      params: Promise.resolve({
        id: COOPER_CLIENT_ID,
        sid: scenarioId,
        cid: changeId,
      }),
    });
    expect(res.status).toBe(200);

    const [row] = await db
      .select()
      .from(scenarioChanges)
      .where(eq(scenarioChanges.id, changeId));
    expect(row.toggleGroupId).toBeNull();

    expect(vi.mocked(recordAudit)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "toggle_group.move_change",
        metadata: expect.objectContaining({
          scenarioId,
          toggleGroupId: null,
        }),
      }),
    );
  });

  it("PATCH with a group from a different scenario returns 400, no audit", async () => {
    vi.mocked(helpers.requireOrgId).mockResolvedValue(COOPER_FIRM_ID);

    const { db } = dbMod;
    const { scenarios, scenarioToggleGroups } = schema;
    const [otherScenario] = await db
      .insert(scenarios)
      .values({
        clientId: COOPER_CLIENT_ID,
        name: `change-cid-other-${randomUUID().slice(0, 6)}`,
        isBaseCase: false,
      })
      .returning();
    createdScenarioIds.push(otherScenario.id);
    const [foreignGroup] = await db
      .insert(scenarioToggleGroups)
      .values({
        scenarioId: otherScenario.id,
        name: "foreign",
        orderIndex: 0,
      })
      .returning();

    const req = makeReq("http://test.local/changes/c", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toggleGroupId: foreignGroup.id }),
    });
    const res = await route.PATCH(req, {
      params: Promise.resolve({
        id: COOPER_CLIENT_ID,
        sid: scenarioId,
        cid: changeId,
      }),
    });
    expect(res.status).toBe(400);
    expect(vi.mocked(recordAudit)).not.toHaveBeenCalled();
  });

  it("PATCH with a wrong-firm caller returns 404 (cross-firm probe)", async () => {
    // Caller's firm is wrong → assertScenarioRouteScope returns 404 from the
    // client-in-firm probe, audit must not fire.
    vi.mocked(helpers.requireOrgId).mockResolvedValue("org_some_other_firm");

    const req = makeReq("http://test.local/changes/c", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toggleGroupId: groupId }),
    });
    const res = await route.PATCH(req, {
      params: Promise.resolve({
        id: COOPER_CLIENT_ID,
        sid: scenarioId,
        cid: changeId,
      }),
    });
    expect(res.status).toBe(404);
    expect(vi.mocked(recordAudit)).not.toHaveBeenCalled();
  });

  it("PATCH with a cid that doesn't belong to sid returns 404", async () => {
    vi.mocked(helpers.requireOrgId).mockResolvedValue(COOPER_FIRM_ID);

    const fakeCid = randomUUID();
    const req = makeReq("http://test.local/changes/c", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toggleGroupId: groupId }),
    });
    const res = await route.PATCH(req, {
      params: Promise.resolve({
        id: COOPER_CLIENT_ID,
        sid: scenarioId,
        cid: fakeCid,
      }),
    });
    expect(res.status).toBe(404);
    expect(vi.mocked(recordAudit)).not.toHaveBeenCalled();
  });
});

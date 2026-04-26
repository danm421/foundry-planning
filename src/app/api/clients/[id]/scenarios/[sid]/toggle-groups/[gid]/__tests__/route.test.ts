// src/app/api/clients/[id]/scenarios/[sid]/toggle-groups/[gid]/__tests__/route.test.ts
//
// Integration tests for the per-toggle-group route (PATCH rename / set
// defaultOn / set requiresGroupId, DELETE with cascade choice). Hits the live
// Neon dev branch via Drizzle, mocking `requireOrgId` for org context and
// `recordAudit` for assertion-on-shape. Patterned after the [sid] route's
// tests.
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

d("scenario toggle-group [gid] route (PATCH / DELETE)", () => {
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

  // We create one or two scenarios per test (one for cross-scenario parent
  // checks). Cascade on scenarios → scenario_toggle_groups + scenario_changes
  // handles all child cleanup.
  const createdScenarioIds: string[] = [];
  let scenarioId: string;
  let groupId: string;

  beforeEach(async () => {
    vi.mocked(helpers.requireOrgId).mockReset();
    vi.mocked(recordAudit).mockClear();
    createdScenarioIds.length = 0;

    const { db } = dbMod;
    const { scenarios, scenarioToggleGroups } = schema;
    const [scenarioRow] = await db
      .insert(scenarios)
      .values({
        clientId: COOPER_CLIENT_ID,
        name: `tg-gid-test-${randomUUID().slice(0, 8)}`,
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

  it("PATCH renames the group and writes audit toggle_group.rename", async () => {
    vi.mocked(helpers.requireOrgId).mockResolvedValue(COOPER_FIRM_ID);

    const newName = `renamed-${randomUUID().slice(0, 6)}`;
    const req = makeReq("http://test.local/toggle-groups/g", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });
    const res = await route.PATCH(req, {
      params: Promise.resolve({
        id: COOPER_CLIENT_ID,
        sid: scenarioId,
        gid: groupId,
      }),
    });
    expect(res.status).toBe(200);

    const { db } = dbMod;
    const { scenarioToggleGroups } = schema;
    const { eq } = drizzleOrm;
    const [row] = await db
      .select()
      .from(scenarioToggleGroups)
      .where(eq(scenarioToggleGroups.id, groupId));
    expect(row.name).toBe(newName);

    expect(vi.mocked(recordAudit)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "toggle_group.rename",
        resourceType: "toggle_group",
        resourceId: groupId,
        clientId: COOPER_CLIENT_ID,
        firmId: COOPER_FIRM_ID,
        metadata: expect.objectContaining({
          scenarioId,
          groupId,
          name: newName,
        }),
      }),
    );
  });

  it("PATCH sets defaultOn=false and writes audit toggle_group.set_default", async () => {
    vi.mocked(helpers.requireOrgId).mockResolvedValue(COOPER_FIRM_ID);

    const req = makeReq("http://test.local/toggle-groups/g", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ defaultOn: false }),
    });
    const res = await route.PATCH(req, {
      params: Promise.resolve({
        id: COOPER_CLIENT_ID,
        sid: scenarioId,
        gid: groupId,
      }),
    });
    expect(res.status).toBe(200);

    const { db } = dbMod;
    const { scenarioToggleGroups } = schema;
    const { eq } = drizzleOrm;
    const [row] = await db
      .select()
      .from(scenarioToggleGroups)
      .where(eq(scenarioToggleGroups.id, groupId));
    expect(row.defaultOn).toBe(false);

    expect(vi.mocked(recordAudit)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "toggle_group.set_default",
        metadata: expect.objectContaining({
          scenarioId,
          groupId,
          defaultOn: false,
        }),
      }),
    );
  });

  it("PATCH sets requiresGroupId to a sibling, writes audit toggle_group.set_required", async () => {
    vi.mocked(helpers.requireOrgId).mockResolvedValue(COOPER_FIRM_ID);

    // Create a sibling parent in the same scenario.
    const { db } = dbMod;
    const { scenarioToggleGroups } = schema;
    const [parent] = await db
      .insert(scenarioToggleGroups)
      .values({
        scenarioId,
        name: "parent",
        defaultOn: true,
        orderIndex: 1,
      })
      .returning();

    const req = makeReq("http://test.local/toggle-groups/g", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requiresGroupId: parent.id }),
    });
    const res = await route.PATCH(req, {
      params: Promise.resolve({
        id: COOPER_CLIENT_ID,
        sid: scenarioId,
        gid: groupId,
      }),
    });
    expect(res.status).toBe(200);

    const { eq } = drizzleOrm;
    const [row] = await db
      .select()
      .from(scenarioToggleGroups)
      .where(eq(scenarioToggleGroups.id, groupId));
    expect(row.requiresGroupId).toBe(parent.id);

    expect(vi.mocked(recordAudit)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "toggle_group.set_required",
        metadata: expect.objectContaining({
          scenarioId,
          groupId,
          requiresGroupId: parent.id,
        }),
      }),
    );
  });

  it("PATCH self-reference (requiresGroupId === gid) returns 400 with no audit", async () => {
    vi.mocked(helpers.requireOrgId).mockResolvedValue(COOPER_FIRM_ID);

    const req = makeReq("http://test.local/toggle-groups/g", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requiresGroupId: groupId }),
    });
    const res = await route.PATCH(req, {
      params: Promise.resolve({
        id: COOPER_CLIENT_ID,
        sid: scenarioId,
        gid: groupId,
      }),
    });
    expect(res.status).toBe(400);
    expect(vi.mocked(recordAudit)).not.toHaveBeenCalled();
  });

  it("PATCH parent already has requiresGroupId (single-level violation) returns 400", async () => {
    vi.mocked(helpers.requireOrgId).mockResolvedValue(COOPER_FIRM_ID);

    // Build A → B → C: A has B as parent (B.requiresGroupId = null then bump),
    // then attempt C → B. C's PATCH must succeed only if B.requiresGroupId is
    // null; we set it via direct DB insert to bypass the API guard.
    const { db } = dbMod;
    const { scenarioToggleGroups } = schema;
    const [grandparent] = await db
      .insert(scenarioToggleGroups)
      .values({ scenarioId, name: "grand", orderIndex: 1 })
      .returning();
    const [parent] = await db
      .insert(scenarioToggleGroups)
      .values({
        scenarioId,
        name: "parent-with-req",
        orderIndex: 2,
        requiresGroupId: grandparent.id,
      })
      .returning();

    const req = makeReq("http://test.local/toggle-groups/g", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requiresGroupId: parent.id }),
    });
    const res = await route.PATCH(req, {
      params: Promise.resolve({
        id: COOPER_CLIENT_ID,
        sid: scenarioId,
        gid: groupId,
      }),
    });
    expect(res.status).toBe(400);
    expect(vi.mocked(recordAudit)).not.toHaveBeenCalled();
  });

  it("PATCH parent in a different scenario returns 400", async () => {
    vi.mocked(helpers.requireOrgId).mockResolvedValue(COOPER_FIRM_ID);

    // Spin up a second scenario + group; using its group as a parent must be
    // rejected even though it's in the same firm/client.
    const { db } = dbMod;
    const { scenarios, scenarioToggleGroups } = schema;
    const [otherScenario] = await db
      .insert(scenarios)
      .values({
        clientId: COOPER_CLIENT_ID,
        name: `tg-other-${randomUUID().slice(0, 6)}`,
        isBaseCase: false,
      })
      .returning();
    createdScenarioIds.push(otherScenario.id);
    const [foreignGroup] = await db
      .insert(scenarioToggleGroups)
      .values({ scenarioId: otherScenario.id, name: "foreign", orderIndex: 0 })
      .returning();

    const req = makeReq("http://test.local/toggle-groups/g", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requiresGroupId: foreignGroup.id }),
    });
    const res = await route.PATCH(req, {
      params: Promise.resolve({
        id: COOPER_CLIENT_ID,
        sid: scenarioId,
        gid: groupId,
      }),
    });
    expect(res.status).toBe(400);
    expect(vi.mocked(recordAudit)).not.toHaveBeenCalled();
  });

  it("PATCH gid that doesn't belong to sid returns 404", async () => {
    vi.mocked(helpers.requireOrgId).mockResolvedValue(COOPER_FIRM_ID);

    const fakeGid = randomUUID();
    const req = makeReq("http://test.local/toggle-groups/g", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "x" }),
    });
    const res = await route.PATCH(req, {
      params: Promise.resolve({
        id: COOPER_CLIENT_ID,
        sid: scenarioId,
        gid: fakeGid,
      }),
    });
    expect(res.status).toBe(404);
    expect(vi.mocked(recordAudit)).not.toHaveBeenCalled();
  });

  it("DELETE moveChangesTo=ungrouped reassigns scenario_changes to NULL and deletes group", async () => {
    vi.mocked(helpers.requireOrgId).mockResolvedValue(COOPER_FIRM_ID);

    // Seed a scenario_change attached to this group so the reassign branch is
    // exercised. Direct insert (bypasses changes-writer) keeps the test focused
    // on the route's tx + audit shape.
    const { db } = dbMod;
    const { scenarioChanges, scenarioToggleGroups } = schema;
    const { and, eq } = drizzleOrm;

    await db.insert(scenarioChanges).values({
      scenarioId,
      opType: "edit",
      targetKind: "income",
      targetId: COOPER_SALARY_INCOME_ID,
      payload: { annualAmount: { from: 250000, to: 300000 } },
      toggleGroupId: groupId,
      orderIndex: 0,
    });

    const req = makeReq(
      "http://test.local/toggle-groups/g?moveChangesTo=ungrouped",
      { method: "DELETE" },
    );
    const res = await route.DELETE(req, {
      params: Promise.resolve({
        id: COOPER_CLIENT_ID,
        sid: scenarioId,
        gid: groupId,
      }),
    });
    expect(res.status).toBe(200);

    // Group is gone.
    const remaining = await db
      .select()
      .from(scenarioToggleGroups)
      .where(eq(scenarioToggleGroups.id, groupId));
    expect(remaining).toHaveLength(0);

    // The change row survives with toggle_group_id = NULL.
    const orphans = await db
      .select()
      .from(scenarioChanges)
      .where(
        and(
          eq(scenarioChanges.scenarioId, scenarioId),
          eq(scenarioChanges.targetId, COOPER_SALARY_INCOME_ID),
        ),
      );
    expect(orphans).toHaveLength(1);
    expect(orphans[0].toggleGroupId).toBeNull();

    expect(vi.mocked(recordAudit)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "toggle_group.delete",
        resourceType: "toggle_group",
        resourceId: groupId,
        metadata: expect.objectContaining({
          scenarioId,
          groupId,
          moveChangesTo: "ungrouped",
        }),
      }),
    );
  });

  it("DELETE moveChangesTo=delete drops scenario_changes and the group", async () => {
    vi.mocked(helpers.requireOrgId).mockResolvedValue(COOPER_FIRM_ID);

    const { db } = dbMod;
    const { scenarioChanges, scenarioToggleGroups } = schema;
    const { and, eq } = drizzleOrm;

    await db.insert(scenarioChanges).values({
      scenarioId,
      opType: "edit",
      targetKind: "income",
      targetId: COOPER_SALARY_INCOME_ID,
      payload: { annualAmount: { from: 250000, to: 320000 } },
      toggleGroupId: groupId,
      orderIndex: 0,
    });

    const req = makeReq(
      "http://test.local/toggle-groups/g?moveChangesTo=delete",
      { method: "DELETE" },
    );
    const res = await route.DELETE(req, {
      params: Promise.resolve({
        id: COOPER_CLIENT_ID,
        sid: scenarioId,
        gid: groupId,
      }),
    });
    expect(res.status).toBe(200);

    const remainingGroups = await db
      .select()
      .from(scenarioToggleGroups)
      .where(eq(scenarioToggleGroups.id, groupId));
    expect(remainingGroups).toHaveLength(0);

    const remainingChanges = await db
      .select()
      .from(scenarioChanges)
      .where(
        and(
          eq(scenarioChanges.scenarioId, scenarioId),
          eq(scenarioChanges.targetId, COOPER_SALARY_INCOME_ID),
        ),
      );
    expect(remainingChanges).toHaveLength(0);

    expect(vi.mocked(recordAudit)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "toggle_group.delete",
        metadata: expect.objectContaining({
          scenarioId,
          groupId,
          moveChangesTo: "delete",
        }),
      }),
    );
  });

  it("DELETE gid not in sid returns 404", async () => {
    vi.mocked(helpers.requireOrgId).mockResolvedValue(COOPER_FIRM_ID);

    const fakeGid = randomUUID();
    const req = makeReq("http://test.local/toggle-groups/g", {
      method: "DELETE",
    });
    const res = await route.DELETE(req, {
      params: Promise.resolve({
        id: COOPER_CLIENT_ID,
        sid: scenarioId,
        gid: fakeGid,
      }),
    });
    expect(res.status).toBe(404);
    expect(vi.mocked(recordAudit)).not.toHaveBeenCalled();
  });
});

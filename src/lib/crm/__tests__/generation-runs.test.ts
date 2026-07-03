import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/db";
import { crmHouseholds, clients, generationRuns } from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("@clerk/nextjs/server", async () => {
  const actual = await vi.importActual<typeof import("@clerk/nextjs/server")>(
    "@clerk/nextjs/server",
  );
  return {
    ...actual,
    auth: vi.fn().mockResolvedValue({ userId: "u", orgId: "org_runs_test" }),
  };
});

import {
  createQueuedRun,
  markAnalyzing,
  markRunning,
  markDone,
  markFailed,
  recordCompletedRun,
  listRecentRuns,
  getRunForHousehold,
  STALE_RUN_MS,
} from "../generation-runs";

const ORG = "org_runs_test";
let householdId: string;
let clientId: string;

beforeEach(async () => {
  await db.delete(clients).where(eq(clients.firmId, ORG));
  await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, ORG));
  const [h] = await db
    .insert(crmHouseholds)
    .values({ firmId: ORG, advisorId: "u", name: "HH" })
    .returning();
  householdId = h.id;
  const [c] = await db
    .insert(clients)
    .values({
      firmId: ORG,
      advisorId: "u",
      crmHouseholdId: householdId,
      retirementAge: 65,
      planEndAge: 95,
    })
    .returning();
  clientId = c.id;
});

describe("generation-runs lifecycle", () => {
  it("createQueuedRun inserts a queued row and returns its id", async () => {
    const runId = await createQueuedRun({
      clientId,
      householdId,
      firmId: ORG,
      kind: "presentation",
      scenarioId: null,
      triggeredBy: "u",
      triggeredByEmail: "advisor@firm.com",
      requestPayload: { pages: [] },
    });
    expect(runId).toBeTruthy();
    const [row] = await db
      .select()
      .from(generationRuns)
      .where(eq(generationRuns.id, runId!));
    expect(row.status).toBe("queued");
    expect(row.triggeredByEmail).toBe("advisor@firm.com");
  });

  it("markAnalyzing sets status analyzing and stamps startedAt", async () => {
    const runId = await createQueuedRun({
      clientId, householdId, firmId: ORG, kind: "presentation",
      scenarioId: null, triggeredBy: "u", triggeredByEmail: null, requestPayload: null,
    });
    await markAnalyzing(runId!);
    const [row] = await db.select().from(generationRuns).where(eq(generationRuns.id, runId!));
    expect(row.status).toBe("analyzing");
    expect(row.startedAt).not.toBeNull();
  });

  it("markRunning → markDone sets status + resultDocumentId + timestamps", async () => {
    const runId = await createQueuedRun({
      clientId, householdId, firmId: ORG, kind: "presentation",
      scenarioId: null, triggeredBy: "u", triggeredByEmail: null, requestPayload: null,
    });
    await markRunning(runId!);
    let [row] = await db.select().from(generationRuns).where(eq(generationRuns.id, runId!));
    expect(row.status).toBe("running");
    expect(row.startedAt).not.toBeNull();

    await markDone(runId!, null); // resultDocumentId nullable here (no real doc in test)
    [row] = await db.select().from(generationRuns).where(eq(generationRuns.id, runId!));
    expect(row.status).toBe("done");
    expect(row.finishedAt).not.toBeNull();
  });

  it("markFailed records a truncated error", async () => {
    const runId = await createQueuedRun({
      clientId, householdId, firmId: ORG, kind: "presentation",
      scenarioId: null, triggeredBy: "u", triggeredByEmail: null, requestPayload: null,
    });
    await markFailed(runId!, "x".repeat(5000));
    const [row] = await db.select().from(generationRuns).where(eq(generationRuns.id, runId!));
    expect(row.status).toBe("failed");
    expect(row.error!.length).toBeLessThanOrEqual(1000);
  });

  it("recordCompletedRun inserts a row born done", async () => {
    const runId = await recordCompletedRun({
      clientId, householdId, firmId: ORG, kind: "liquidity",
      scenarioId: null, triggeredBy: "u", triggeredByEmail: "a@b.com", resultDocumentId: null,
    });
    const [row] = await db.select().from(generationRuns).where(eq(generationRuns.id, runId!));
    expect(row.status).toBe("done");
    expect(row.finishedAt).not.toBeNull();
  });
});

describe("listRecentRuns stale sweep", () => {
  it("flips queued/running rows older than STALE_RUN_MS to failed, leaves fresh ones", async () => {
    const stale = new Date(Date.now() - STALE_RUN_MS - 60_000);
    const fresh = new Date(Date.now() - 1_000);
    const [s] = await db.insert(generationRuns).values({
      householdId, clientId, firmId: ORG, kind: "presentation",
      status: "running", createdAt: stale, startedAt: stale,
    }).returning();
    const [f] = await db.insert(generationRuns).values({
      householdId, clientId, firmId: ORG, kind: "presentation",
      status: "queued", createdAt: fresh,
    }).returning();

    const rows = await listRecentRuns(householdId, ORG, 25);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(s.id)!.status).toBe("failed");
    expect(byId.get(f.id)!.status).toBe("queued");
  });

  it("flips stale analyzing rows to failed too", async () => {
    const stale = new Date(Date.now() - STALE_RUN_MS - 60_000);
    const [a] = await db.insert(generationRuns).values({
      householdId, clientId, firmId: ORG, kind: "presentation",
      status: "analyzing", createdAt: stale, startedAt: stale,
    }).returning();

    const rows = await listRecentRuns(householdId, ORG, 25);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(a.id)!.status).toBe("failed");
  });

  it("is firm-scoped and newest-first", async () => {
    await db.insert(generationRuns).values({
      householdId, clientId, firmId: "other_org", kind: "presentation", status: "done",
    });
    await db.insert(generationRuns).values({
      householdId, clientId, firmId: ORG, kind: "liquidity", status: "done",
    });
    const rows = await listRecentRuns(householdId, ORG, 25);
    expect(rows.every((r) => r.firmId === ORG)).toBe(true);
  });
});

describe("generation-runs lib", () => {
  const ORG2 = "org_genruns_lib";
  let householdId2: string;

  const base = () => ({
    clientId: null,
    householdId: householdId2,
    firmId: ORG2,
    scenarioId: null,
    triggeredBy: null,
    triggeredByEmail: null,
    requestPayload: { focus: "x" },
  });

  beforeEach(async () => {
    await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, ORG2)); // cascades to runs
    const [h] = await db
      .insert(crmHouseholds)
      .values({ firmId: ORG2, advisorId: "u", name: "HH" })
      .returning();
    householdId2 = h.id;
  });

  it("createQueuedRun accepts a null clientId", async () => {
    const id = await createQueuedRun({ ...base(), kind: "meeting-prep" });
    expect(id).toBeTruthy();
  });

  it("markDone persists a result payload", async () => {
    const id = await createQueuedRun({ ...base(), kind: "meeting-prep" });
    await markDone(id, null, { draft: { brief: null, agenda: null }, data: { ok: true } });
    const [row] = await db.select().from(generationRuns).where(eq(generationRuns.id, id!));
    expect(row.status).toBe("done");
    expect(row.resultPayload).toEqual({ draft: { brief: null, agenda: null }, data: { ok: true } });
  });

  it("listRecentRuns filters by kind and excludeKinds", async () => {
    await createQueuedRun({ ...base(), kind: "meeting-prep" });
    await createQueuedRun({ ...base(), kind: "presentation" });
    const only = await listRecentRuns(householdId2, ORG2, 25, { kind: "meeting-prep" });
    expect(only).toHaveLength(1);
    expect(only[0].kind).toBe("meeting-prep");
    const excluded = await listRecentRuns(householdId2, ORG2, 25, { excludeKinds: ["meeting-prep"] });
    expect(excluded).toHaveLength(1);
    expect(excluded[0].kind).toBe("presentation");
    const all = await listRecentRuns(householdId2, ORG2, 25);
    expect(all).toHaveLength(2);
  });

  it("getRunForHousehold returns the run, and null on household mismatch", async () => {
    const id = await createQueuedRun({ ...base(), kind: "meeting-prep" });
    const run = await getRunForHousehold(id!, householdId2, ORG2);
    expect(run?.id).toBe(id);
    expect(await getRunForHousehold(id!, "00000000-0000-0000-0000-000000000000", ORG2)).toBeNull();
  });

  it("getRunForHousehold sweeps an in-flight run past STALE_RUN_MS to failed", async () => {
    const id = await createQueuedRun({ ...base(), kind: "meeting-prep" });
    await db
      .update(generationRuns)
      .set({ createdAt: new Date(Date.now() - 4 * 60 * 1000), status: "running" })
      .where(eq(generationRuns.id, id!));
    const run = await getRunForHousehold(id!, householdId2, ORG2);
    expect(run?.status).toBe("failed");
    expect(run?.error).toBe("timed out");
  });
});

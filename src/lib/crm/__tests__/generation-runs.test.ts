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

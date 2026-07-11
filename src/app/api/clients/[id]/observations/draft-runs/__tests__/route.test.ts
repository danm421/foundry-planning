import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/db";
import { clients, crmHouseholds, generationRuns } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { ClientData } from "@/engine/types";
import type { ProjectionResult } from "@/engine/projection";

// Capture after() callbacks so the test can await the background work
// deterministically instead of racing the real DB (mirrors
// presentations/runs/__tests__/route.test.ts).
const { afterTasks } = vi.hoisted(() => ({ afterTasks: [] as Array<Promise<unknown>> }));

const {
  mockCheckObservationsAiRateLimit,
  mockLoadEffectiveTree,
  mockRunProjectionWithEvents,
  mockGetOrComputeMonteCarlo,
  mockBuildObservationsFacts,
  mockGenerateObservationsDraft,
} = vi.hoisted(() => ({
  mockCheckObservationsAiRateLimit: vi.fn(),
  mockLoadEffectiveTree: vi.fn(),
  mockRunProjectionWithEvents: vi.fn(),
  mockGetOrComputeMonteCarlo: vi.fn(),
  mockBuildObservationsFacts: vi.fn(),
  mockGenerateObservationsDraft: vi.fn(),
}));

vi.mock("@/lib/db-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-helpers")>();
  return { ...actual, requireOrgId: vi.fn().mockResolvedValue("org_obs_draft_rt") };
});
vi.mock("@clerk/nextjs/server", async () => {
  const actual = await vi.importActual<typeof import("@clerk/nextjs/server")>("@clerk/nextjs/server");
  return {
    ...actual,
    auth: vi.fn().mockResolvedValue({ userId: "u_obs", orgId: "org_obs_draft_rt" }),
    currentUser: vi.fn().mockResolvedValue({ emailAddresses: [{ emailAddress: "advisor@firm.com" }] }),
  };
});
vi.mock("@/lib/authz", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authz")>();
  return {
    ...actual,
    requireActiveSubscriptionForFirm: vi.fn().mockResolvedValue(undefined),
  };
});
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkObservationsAiRateLimit: mockCheckObservationsAiRateLimit };
});
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return {
    ...actual,
    after: (fn: () => unknown) => {
      afterTasks.push(Promise.resolve().then(() => fn()));
    },
  };
});
vi.mock("@/lib/scenario/loader", () => ({ loadEffectiveTree: mockLoadEffectiveTree }));
vi.mock("@/engine/projection", () => ({ runProjectionWithEvents: mockRunProjectionWithEvents }));
vi.mock("@/lib/compute-cache/monte-carlo", () => ({ getOrComputeMonteCarlo: mockGetOrComputeMonteCarlo }));
vi.mock("@/lib/observations/draft", () => ({
  buildObservationsFacts: mockBuildObservationsFacts,
  generateObservationsDraft: mockGenerateObservationsDraft,
}));

import { POST } from "../route";

const ORG = "org_obs_draft_rt";
let clientId: string;

const FAKE_CLIENT_DATA = { client: { firstName: "Test" } } as unknown as ClientData;
const FAKE_PROJECTION = { years: [{ year: 2026 }] } as unknown as ProjectionResult;
const FAKE_SUGGESTIONS = {
  suggestions: [
    {
      section: "observation",
      topic: "retirement",
      title: null,
      body: "On track for retirement.",
      owner: null,
      priority: null,
    },
  ],
};

beforeEach(async () => {
  afterTasks.length = 0;
  await db.delete(clients).where(eq(clients.firmId, ORG));
  await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, ORG)); // cascades to runs
  const [h] = await db
    .insert(crmHouseholds)
    .values({ firmId: ORG, advisorId: "u_obs", name: "HH" })
    .returning();
  const [c] = await db
    .insert(clients)
    .values({ firmId: ORG, advisorId: "u_obs", crmHouseholdId: h.id, retirementAge: 65, planEndAge: 95 })
    .returning();
  clientId = c.id;

  mockCheckObservationsAiRateLimit.mockReset().mockResolvedValue({ allowed: true, remaining: 5, reset: 0 });
  mockLoadEffectiveTree.mockReset().mockResolvedValue({ effectiveTree: FAKE_CLIENT_DATA });
  mockRunProjectionWithEvents.mockReset().mockReturnValue(FAKE_PROJECTION);
  mockGetOrComputeMonteCarlo.mockReset().mockResolvedValue({ payload: { summary: { successRate: 0.9 } } });
  mockBuildObservationsFacts.mockReset().mockReturnValue("FACT SHEET");
  mockGenerateObservationsDraft.mockReset().mockResolvedValue(FAKE_SUGGESTIONS);
});

function req(body: unknown = {}) {
  return new Request("http://t/draft-runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

describe("POST /api/clients/[id]/observations/draft-runs", () => {
  it("returns 202 with a runId, and the background job reaches done with the parsed suggestions", async () => {
    const res = await POST(req(), { params: Promise.resolve({ id: clientId }) });
    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json.runId).toBeTruthy();

    await Promise.all(afterTasks);

    const [row] = await db.select().from(generationRuns).where(eq(generationRuns.id, json.runId));
    expect(row.status).toBe("done");
    expect(row.kind).toBe("observations-draft");
    expect(row.clientId).toBe(clientId);
    expect(row.triggeredByEmail).toBe("advisor@firm.com");
    expect(row.resultPayload).toEqual({ suggestions: FAKE_SUGGESTIONS.suggestions });

    // The background job fetches the effective tree, runs the projection,
    // computes MC, builds the fact sheet from those exact results, and only
    // then calls the model.
    expect(mockLoadEffectiveTree).toHaveBeenCalledWith(clientId, ORG, "base", {});
    expect(mockGetOrComputeMonteCarlo).toHaveBeenCalledWith({
      clientId,
      firmId: ORG,
      scenarioId: "base",
    });
    expect(mockBuildObservationsFacts).toHaveBeenCalledWith({
      clientData: FAKE_CLIENT_DATA,
      projection: FAKE_PROJECTION,
      monteCarlo: { successRate: 0.9 },
    });
    expect(mockGenerateObservationsDraft).toHaveBeenCalledWith("FACT SHEET");
  });

  it("passes a scenario from the request body through to loadEffectiveTree and Monte Carlo", async () => {
    const res = await POST(req({ scenario: "scn-1" }), { params: Promise.resolve({ id: clientId }) });
    expect(res.status).toBe(202);
    await Promise.all(afterTasks);
    expect(mockLoadEffectiveTree).toHaveBeenCalledWith(clientId, ORG, "scn-1", {});
    expect(mockGetOrComputeMonteCarlo).toHaveBeenCalledWith({
      clientId,
      firmId: ORG,
      scenarioId: "scn-1",
    });
  });

  it("marks the run failed when the background job throws", async () => {
    mockGenerateObservationsDraft.mockRejectedValue(new Error("model unavailable"));
    const res = await POST(req(), { params: Promise.resolve({ id: clientId }) });
    const json = await res.json();
    await Promise.all(afterTasks);
    const [row] = await db.select().from(generationRuns).where(eq(generationRuns.id, json.runId));
    expect(row.status).toBe("failed");
    expect(row.error).toBe("model unavailable");
  });

  it("429s when the rate limiter denies, without creating a run", async () => {
    mockCheckObservationsAiRateLimit.mockResolvedValue({ allowed: false, reason: "exceeded", reset: Date.now() + 1000 });
    const res = await POST(req(), { params: Promise.resolve({ id: clientId }) });
    expect(res.status).toBe(429);
    const rows = await db.select().from(generationRuns).where(eq(generationRuns.clientId, clientId));
    expect(rows).toHaveLength(0);
  });

  it("403s for a client outside the caller's firm/access", async () => {
    const res = await POST(req(), {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(res.status).toBe(403);
  });
});

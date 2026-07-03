import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/db";
import { crmHouseholds, clients, generationRuns } from "@/db/schema";
import { eq } from "drizzle-orm";
import { generateMeetingPrepDraft } from "@/lib/crm/meeting-prep/generate";

const { afterTasks } = vi.hoisted(() => ({ afterTasks: [] as Array<Promise<unknown>> }));

vi.mock("@/lib/db-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-helpers")>();
  return { ...actual, requireOrgId: vi.fn().mockResolvedValue("org_mp_runs") };
});
vi.mock("@clerk/nextjs/server", async () => {
  const actual = await vi.importActual<typeof import("@clerk/nextjs/server")>("@clerk/nextjs/server");
  return {
    ...actual,
    auth: vi.fn().mockResolvedValue({ userId: "u", orgId: "org_mp_runs" }),
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
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return {
    ...actual,
    after: (fn: () => unknown) => {
      afterTasks.push(Promise.resolve().then(() => fn()));
    },
  };
});
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return {
    ...actual,
    checkMeetingPrepRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  };
});
vi.mock("@/lib/crm/meeting-prep/battery", () => ({
  loadMeetingPrepBattery: vi.fn().mockResolvedValue({
    household: { id: "h", name: "HH", clientSince: "2026-01-01" },
    contacts: [],
    windowStart: "2026-04-01",
    lastMeetingDate: null,
    notesInWindow: [],
    recentNotes: [],
    outstandingTasks: [],
    completedTasks: [],
    portfolio: { total: 0, byCategory: [], accounts: [] },
    vitals: null,
    alerts: [],
  }),
}));
vi.mock("@/lib/crm/meeting-prep/generate", () => ({
  generateMeetingPrepDraft: vi.fn().mockResolvedValue({
    brief: { briefing: "Hi.", sinceLastMeeting: [], talkingPoints: [], openQuestions: [], personalNotes: [] },
    agenda: null,
  }),
}));

import { POST } from "../route";

const ORG = "org_mp_runs";
let householdId: string;

beforeEach(async () => {
  afterTasks.length = 0;
  await db.delete(clients).where(eq(clients.firmId, ORG));
  await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, ORG));
  const [h] = await db.insert(crmHouseholds).values({ firmId: ORG, advisorId: "u", name: "HH" }).returning();
  householdId = h.id;
  vi.mocked(generateMeetingPrepDraft).mockClear();
});

function req(body: unknown) {
  return new Request("http://t/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

const validBody = {
  focus: "Annual review",
  context: "",
  meetingDate: "2026-07-03",
  windowStart: null,
  docs: ["brief"],
};

describe("POST meeting-prep/runs", () => {
  it("returns 202 and the run reaches done with the draft in result_payload (null clientId)", async () => {
    const res = await POST(req(validBody), { params: Promise.resolve({ id: householdId }) });
    expect(res.status).toBe(202);
    const { runId } = await res.json();
    expect(runId).toBeTruthy();

    await Promise.all(afterTasks);

    const [row] = await db.select().from(generationRuns).where(eq(generationRuns.id, runId));
    expect(row.status).toBe("done");
    expect(row.kind).toBe("meeting-prep");
    expect(row.clientId).toBeNull();
    expect(row.triggeredByEmail).toBe("advisor@firm.com");
    expect(row.requestPayload).toMatchObject({ focus: "Annual review" });
    expect(row.resultPayload).toMatchObject({
      draft: { brief: { briefing: "Hi." }, agenda: null },
      data: { windowStart: "2026-04-01" },
    });
  });

  it("links the run to the planning client when one exists", async () => {
    const [c] = await db.insert(clients).values({
      firmId: ORG, advisorId: "u", crmHouseholdId: householdId, retirementAge: 65, planEndAge: 95,
    }).returning();
    const res = await POST(req(validBody), { params: Promise.resolve({ id: householdId }) });
    const { runId } = await res.json();
    await Promise.all(afterTasks);
    const [row] = await db.select().from(generationRuns).where(eq(generationRuns.id, runId));
    expect(row.clientId).toBe(c.id);
  });

  it("marks the run failed with friendly copy when AI is unconfigured", async () => {
    vi.mocked(generateMeetingPrepDraft).mockRejectedValueOnce(new Error("ai_not_configured"));
    const res = await POST(req(validBody), { params: Promise.resolve({ id: householdId }) });
    const { runId } = await res.json();
    await Promise.all(afterTasks);
    const [row] = await db.select().from(generationRuns).where(eq(generationRuns.id, runId));
    expect(row.status).toBe("failed");
    expect(row.error).toBe("AI is not configured for this environment.");
  });

  it("400s on an invalid setup", async () => {
    const res = await POST(req({ focus: "" }), { params: Promise.resolve({ id: householdId }) });
    expect(res.status).toBe(400);
    expect(await db.select().from(generationRuns).where(eq(generationRuns.householdId, householdId))).toHaveLength(0);
  });

  it("404s for a household outside the firm", async () => {
    const res = await POST(req(validBody), {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(res.status).toBe(404);
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/db";
import { clients, crmHouseholds, generationRuns } from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({
    userId: "user_test_draft_run",
    orgId: "firm_test_draft_run",
    sessionClaims: { org_public_metadata: { is_founder: true } },
  })),
}));

const FIRM = "firm_test_draft_run";
const FIRM_OTHER = "firm_test_draft_run_other";

let clientId: string;
let householdId: string;
let clientOtherId: string;
let runId: string;
let presentationRunId: string;
let otherFirmRunId: string;

async function seedClient(firmId: string, name: string) {
  const [h] = await db.insert(crmHouseholds).values({ firmId, advisorId: "advisor_test", name }).returning();
  const [c] = await db
    .insert(clients)
    .values({ firmId, advisorId: "advisor_test", crmHouseholdId: h.id, retirementAge: 65, planEndAge: 95 })
    .returning();
  return { clientId: c.id, householdId: h.id };
}

beforeEach(async () => {
  await db.delete(clients).where(eq(clients.firmId, FIRM));
  await db.delete(clients).where(eq(clients.firmId, FIRM_OTHER));
  await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, FIRM)); // cascades to runs
  await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, FIRM_OTHER));

  const a = await seedClient(FIRM, "Alpha");
  const b = await seedClient(FIRM_OTHER, "Beta");
  clientId = a.clientId;
  householdId = a.householdId;
  clientOtherId = b.clientId;

  const [run] = await db
    .insert(generationRuns)
    .values({
      householdId,
      clientId,
      firmId: FIRM,
      kind: "observations-draft",
      status: "done",
      resultPayload: { suggestions: [{ section: "observation", topic: "general", body: "x" }] },
    })
    .returning();
  runId = run.id;

  const [presoRun] = await db
    .insert(generationRuns)
    .values({ householdId, clientId, firmId: FIRM, kind: "presentation", status: "done" })
    .returning();
  presentationRunId = presoRun.id;

  const [otherRun] = await db
    .insert(generationRuns)
    .values({ householdId: b.householdId, clientId: clientOtherId, firmId: FIRM_OTHER, kind: "observations-draft", status: "done" })
    .returning();
  otherFirmRunId = otherRun.id;
});

// Import AFTER mocks are declared.
import { GET } from "../route";

function makeReq() {
  return new Request("http://test/api") as unknown as import("next/server").NextRequest;
}

describe("GET /api/clients/[id]/observations/draft-runs/[runId]", () => {
  it("200s with status/error/suggestions parsed from resultPayload", async () => {
    const res = await GET(makeReq(), { params: Promise.resolve({ id: clientId, runId }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("done");
    expect(body.error).toBeNull();
    expect(body.suggestions).toEqual([{ section: "observation", topic: "general", body: "x" }]);
  });

  it("returns suggestions: null for a run still in progress (no resultPayload)", async () => {
    const [queued] = await db
      .insert(generationRuns)
      .values({ householdId, clientId, firmId: FIRM, kind: "observations-draft", status: "queued" })
      .returning();
    const res = await GET(makeReq(), { params: Promise.resolve({ id: clientId, runId: queued.id }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("queued");
    expect(body.suggestions).toBeNull();
  });

  it("404s for a run belonging to a different client's firm", async () => {
    const res = await GET(makeReq(), { params: Promise.resolve({ id: clientId, runId: otherFirmRunId }) });
    expect(res.status).toBe(404);
  });

  it("404s for an unknown runId", async () => {
    const res = await GET(makeReq(), {
      params: Promise.resolve({ id: clientId, runId: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(res.status).toBe(404);
  });

  it("404s on a malformed (non-uuid) runId", async () => {
    const res = await GET(makeReq(), { params: Promise.resolve({ id: clientId, runId: "not-a-uuid" }) });
    expect(res.status).toBe(404);
  });

  it("404s on cross-firm client read", async () => {
    const res = await GET(makeReq(), { params: Promise.resolve({ id: clientOtherId, runId }) });
    expect(res.status).toBe(404);
  });

  it("404s when the client does not exist", async () => {
    const res = await GET(makeReq(), {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000", runId }),
    });
    expect(res.status).toBe(404);
  });

  it("404s for a run of a different kind against the same household", async () => {
    const res = await GET(makeReq(), { params: Promise.resolve({ id: clientId, runId: presentationRunId }) });
    expect(res.status).toBe(404);
  });
});

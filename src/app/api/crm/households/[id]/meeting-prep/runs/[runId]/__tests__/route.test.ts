import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/db";
import { crmHouseholds, generationRuns } from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("@/lib/db-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-helpers")>();
  return { ...actual, requireOrgId: vi.fn().mockResolvedValue("org_mp_run_detail") };
});
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "u", orgId: "org_mp_run_detail" }),
}));

import { GET } from "../route";

const ORG = "org_mp_run_detail";
let householdId: string;
let runId: string;

beforeEach(async () => {
  await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, ORG));
  const [h] = await db.insert(crmHouseholds).values({ firmId: ORG, advisorId: "u", name: "HH" }).returning();
  householdId = h.id;
  const [r] = await db.insert(generationRuns).values({
    householdId, clientId: null, firmId: ORG, kind: "meeting-prep", status: "done",
    requestPayload: { focus: "x" }, resultPayload: { draft: { brief: null, agenda: null }, data: {} },
  }).returning();
  runId = r.id;
});

function req() {
  return new Request("http://t/run") as unknown as import("next/server").NextRequest;
}

describe("GET meeting-prep/runs/[runId]", () => {
  it("returns the run with its result payload", async () => {
    const res = await GET(req(), { params: Promise.resolve({ id: householdId, runId }) });
    expect(res.status).toBe(200);
    const { run } = await res.json();
    expect(run.id).toBe(runId);
    expect(run.resultPayload).toMatchObject({ draft: { brief: null, agenda: null } });
  });

  it("404s when the run belongs to another household", async () => {
    const [other] = await db.insert(crmHouseholds).values({ firmId: ORG, advisorId: "u", name: "Other" }).returning();
    const res = await GET(req(), { params: Promise.resolve({ id: other.id, runId }) });
    expect(res.status).toBe(404);
  });

  it("404s on a malformed runId instead of erroring", async () => {
    const res = await GET(req(), { params: Promise.resolve({ id: householdId, runId: "not-a-uuid" }) });
    expect(res.status).toBe(404);
  });
});

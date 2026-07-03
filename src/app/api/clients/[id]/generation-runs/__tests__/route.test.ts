import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/db";
import { crmHouseholds, clients, generationRuns } from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("@/lib/db-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-helpers")>();
  return { ...actual, requireOrgId: vi.fn().mockResolvedValue("org_runs_get") };
});

// Phase 1b: routes gate via verifyClientAccess → auth() from @clerk/nextjs/server.
// Mock it so the staff-scope check is a no-op (undefined orgRole ⇒ non-staff ⇒
// access turns purely on the firm-scoped clients query the test already drives).
vi.mock("@clerk/nextjs/server", () => ({
  // orgId = ORG (inlined — vi.mock is hoisted) so the real requireClientAccess
  // own-firm path (`client.firmId === orgId`) matches the seeded client's firm.
  auth: vi.fn().mockResolvedValue({ userId: "user_test", orgId: "org_runs_get" }),
}));

import { GET } from "../route";

const ORG = "org_runs_get";
let clientId: string;
let householdId: string;

beforeEach(async () => {
  await db.delete(clients).where(eq(clients.firmId, ORG));
  await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, ORG));
  const [h] = await db.insert(crmHouseholds).values({ firmId: ORG, advisorId: "u", name: "HH" }).returning();
  householdId = h.id;
  const [c] = await db.insert(clients).values({
    firmId: ORG, advisorId: "u", crmHouseholdId: householdId, retirementAge: 65, planEndAge: 95,
  }).returning();
  clientId = c.id;
});

function get() {
  return new Request("http://t/generation-runs") as unknown as import("next/server").NextRequest;
}

describe("GET generation-runs", () => {
  it("returns the household's runs newest-first", async () => {
    await db.insert(generationRuns).values({
      householdId, clientId, firmId: ORG, kind: "presentation", status: "done",
    });
    const res = await GET(get(), { params: Promise.resolve({ id: clientId }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.runs)).toBe(true);
    expect(json.runs[0].kind).toBe("presentation");
  });

  it("404s for a client outside the firm", async () => {
    const res = await GET(get(), {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(res.status).toBe(404);
  });

  it("excludes meeting-prep runs from the presentations feed", async () => {
    await db.insert(generationRuns).values([
      { householdId, clientId, firmId: ORG, kind: "presentation", status: "done" },
      { householdId, clientId: null, firmId: ORG, kind: "meeting-prep", status: "done" },
    ]);
    const res = await GET(get(), { params: Promise.resolve({ id: clientId }) });
    const json = await res.json();
    expect(json.runs).toHaveLength(1);
    expect(json.runs[0].kind).toBe("presentation");
  });
});

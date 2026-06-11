// src/app/api/clients/[id]/__tests__/planner-scope.test.ts
//
// Phase-1b end-to-end negative test. Proves the per-client API routes are
// actually wired to the advisor-aware gate (not just that the helper works —
// that lives in src/lib/clients/__tests__/authz.test.ts). A `planner` mapped to
// advisor A reaches A's client but is denied B's client by *direct API call*,
// across a Shape-B route (`route.ts` GET) and a Shape-C indirect route
// (`monte-carlo-data` GET). Real DB for the scope tables; only the heavy MC
// engine load is mocked so the gate alone decides 200 vs 404.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/db";
import { clients, crmHouseholds, staffAdvisorVisibility } from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("@/lib/db-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-helpers")>();
  return { ...actual, requireOrgId: vi.fn().mockResolvedValue("org_planner_scope") };
});
vi.mock("@clerk/nextjs/server", async () => {
  const actual = await vi.importActual<typeof import("@clerk/nextjs/server")>(
    "@clerk/nextjs/server",
  );
  return { ...actual, auth: vi.fn() };
});
// Projection rate limit needs Upstash; let it pass in unit tests.
vi.mock("@/lib/rate-limit", () => ({
  checkProjectionRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  rateLimitErrorResponse: vi.fn(),
}));
// Isolate the gate from the MC engine: a mapped caller that clears the gate
// gets a 200 from this stub; an unmapped caller never reaches it (404 at gate).
const { loadMonteCarloData } = vi.hoisted(() => ({
  loadMonteCarloData: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock("@/lib/projection/load-monte-carlo-data", () => ({ loadMonteCarloData }));

import { auth } from "@clerk/nextjs/server";
import { GET as getClient } from "../route";
import { GET as getMonteCarlo } from "../monte-carlo-data/route";

const ORG = "org_planner_scope";
const ADV_A = "adv_a";
const ADV_B = "adv_b";
const PLANNER = "user_planner_scope";

let clientA: string;
let clientB: string;

function setAuth(userId: string, orgRole?: string) {
  vi.mocked(auth).mockResolvedValue({ userId, orgId: ORG, orgRole } as never);
}

function req() {
  return new Request("http://test.local") as unknown as import("next/server").NextRequest;
}

async function seedClient(advisorId: string): Promise<string> {
  const [h] = await db
    .insert(crmHouseholds)
    .values({ firmId: ORG, advisorId, name: "HH" })
    .returning();
  const [c] = await db
    .insert(clients)
    .values({
      firmId: ORG,
      advisorId,
      crmHouseholdId: h.id,
      retirementAge: 65,
      planEndAge: 95,
    })
    .returning();
  return c.id;
}

beforeEach(async () => {
  vi.mocked(loadMonteCarloData).mockClear();
  await db.delete(clients).where(eq(clients.firmId, ORG));
  await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, ORG));
  await db.delete(staffAdvisorVisibility).where(eq(staffAdvisorVisibility.firmId, ORG));

  clientA = await seedClient(ADV_A);
  clientB = await seedClient(ADV_B);

  // Map the planner to advisor A only.
  await db.insert(staffAdvisorVisibility).values({
    firmId: ORG,
    staffUserId: PLANNER,
    advisorUserId: ADV_A,
  });
  setAuth(PLANNER, "org:planner");
});

describe("planner per-client API scope (Phase 1b)", () => {
  it("route.ts GET: 200 on the mapped advisor's client", async () => {
    const res = await getClient(req(), { params: Promise.resolve({ id: clientA }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe(clientA);
  });

  it("route.ts GET: 404 on an unmapped advisor's client (IDOR closed)", async () => {
    const res = await getClient(req(), { params: Promise.resolve({ id: clientB }) });
    expect(res.status).toBe(404);
  });

  it("monte-carlo-data GET: reaches the engine for the mapped client", async () => {
    const res = await getMonteCarlo(req(), { params: Promise.resolve({ id: clientA }) });
    expect(res.status).toBe(200);
    expect(loadMonteCarloData).toHaveBeenCalledWith(clientA, ORG);
  });

  it("monte-carlo-data GET: 404 on the unmapped client, before any engine work", async () => {
    const res = await getMonteCarlo(req(), { params: Promise.resolve({ id: clientB }) });
    expect(res.status).toBe(404);
    expect(loadMonteCarloData).not.toHaveBeenCalled();
  });

  it("a firm-wide member still sees both clients", async () => {
    setAuth("user_member", "org:member");
    const a = await getClient(req(), { params: Promise.resolve({ id: clientA }) });
    const b = await getClient(req(), { params: Promise.resolve({ id: clientB }) });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
  });
});

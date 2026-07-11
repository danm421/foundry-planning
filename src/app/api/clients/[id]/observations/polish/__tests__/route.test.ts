import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/db";
import { clients, crmHouseholds } from "@/db/schema";
import { eq } from "drizzle-orm";

// Mirrors draft-runs/__tests__/route.test.ts's mocking style: real DB for
// requireClientEditAccess (own-firm path), mocked auth/subscription/rate-limit,
// and here the synchronous model call itself.
const { mockCheckObservationsAiRateLimit, mockCallAIExtraction } = vi.hoisted(() => ({
  mockCheckObservationsAiRateLimit: vi.fn(),
  mockCallAIExtraction: vi.fn(),
}));

vi.mock("@/lib/db-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-helpers")>();
  return { ...actual, requireOrgId: vi.fn().mockResolvedValue("org_obs_polish_rt") };
});
vi.mock("@clerk/nextjs/server", async () => {
  const actual = await vi.importActual<typeof import("@clerk/nextjs/server")>("@clerk/nextjs/server");
  return {
    ...actual,
    auth: vi.fn().mockResolvedValue({ userId: "u_obs_polish", orgId: "org_obs_polish_rt" }),
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
vi.mock("@/lib/extraction/azure-client", () => ({ callAIExtraction: mockCallAIExtraction }));

import { POST } from "../route";

const ORG = "org_obs_polish_rt";
let clientId: string;

beforeEach(async () => {
  await db.delete(clients).where(eq(clients.firmId, ORG));
  await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, ORG));
  const [h] = await db
    .insert(crmHouseholds)
    .values({ firmId: ORG, advisorId: "u_obs_polish", name: "HH" })
    .returning();
  const [c] = await db
    .insert(clients)
    .values({ firmId: ORG, advisorId: "u_obs_polish", crmHouseholdId: h.id, retirementAge: 65, planEndAge: 95 })
    .returning();
  clientId = c.id;

  mockCheckObservationsAiRateLimit.mockReset().mockResolvedValue({ allowed: true, remaining: 5, reset: 0 });
  mockCallAIExtraction.mockReset().mockResolvedValue("Rewritten: your net worth is {{net_worth}}.\n");
});

function req(body: unknown): import("next/server").NextRequest {
  return new Request("http://t/polish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

describe("POST /api/clients/[id]/observations/polish", () => {
  it("200s with the rewritten body, and a submitted {{token}} round-trips through the mocked rewrite", async () => {
    const res = await POST(req({ body: "Your net worth is {{net_worth}}." }), {
      params: Promise.resolve({ id: clientId }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    // Trimmed passthrough of the mocked model output — the exact match
    // below also proves the {{net_worth}} token round-tripped verbatim.
    expect(json.body).toBe("Rewritten: your net worth is {{net_worth}}.");

    expect(mockCallAIExtraction).toHaveBeenCalledWith(
      expect.stringContaining("Preserve every"),
      "Your net worth is {{net_worth}}.",
    );
  });

  it("429s when the rate limiter denies, without calling the model", async () => {
    mockCheckObservationsAiRateLimit.mockResolvedValue({
      allowed: false,
      reason: "exceeded",
      reset: Date.now() + 1000,
    });
    const res = await POST(req({ body: "Some body text." }), {
      params: Promise.resolve({ id: clientId }),
    });
    expect(res.status).toBe(429);
    expect(mockCallAIExtraction).not.toHaveBeenCalled();
  });

  it("400s on an empty body", async () => {
    const res = await POST(req({ body: "" }), { params: Promise.resolve({ id: clientId }) });
    expect(res.status).toBe(400);
  });

  it("400s on invalid JSON", async () => {
    const badReq = new Request("http://t/polish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    }) as unknown as import("next/server").NextRequest;
    const res = await POST(badReq, { params: Promise.resolve({ id: clientId }) });
    expect(res.status).toBe(400);
  });

  it("403s for a client outside the caller's firm/access", async () => {
    const res = await POST(req({ body: "Some body text." }), {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(res.status).toBe(403);
  });
});

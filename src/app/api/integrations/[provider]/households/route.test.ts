import { describe, it, expect, vi, beforeEach } from "vitest";

const getHouseholds = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/integrations/registry", () => ({
  isProviderId: () => true,
  getProvider: () => ({
    id: "orion",
    label: "Orion",
    syncs: true,
    isEnabled: () => true,
    client: { getHouseholds },
  }),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkIntegrationApiLimit: vi.fn(),
  rateLimitErrorResponse: vi.fn(
    () => new Response(JSON.stringify({ error: "rl" }), { status: 429 }),
  ),
}));
vi.mock("@/lib/integrations/auth", () => ({ makeCallContext: vi.fn() }));
vi.mock("@/lib/integrations/households", () => ({ getHouseholdLinks: vi.fn() }));
vi.mock("@/lib/activity/resolve-actors", () => ({ resolveActors: vi.fn() }));

import { GET } from "./route";
import { auth } from "@clerk/nextjs/server";
import { checkIntegrationApiLimit } from "@/lib/rate-limit";
import { makeCallContext } from "@/lib/integrations/auth";
import { getHouseholdLinks } from "@/lib/integrations/households";
import { resolveActors } from "@/lib/activity/resolve-actors";

/* eslint-disable @typescript-eslint/no-explicit-any */

const ctx = () => ({ params: Promise.resolve({ provider: "orion" }) });
const req = () => new Request("https://app.test/api/integrations/orion/households");

beforeEach(() => {
  vi.clearAllMocks();
  (auth as any).mockResolvedValue({ orgId: "firm_1", userId: "admin1", orgRole: "org:admin" });
  (checkIntegrationApiLimit as any).mockResolvedValue({ allowed: true });
  (makeCallContext as any).mockResolvedValue({});
  getHouseholds.mockResolvedValue([{ id: "1234567", name: "Doe Family" }]);
  (getHouseholdLinks as any).mockResolvedValue([]);
  (resolveActors as any).mockResolvedValue(new Map());
});

describe("GET …/households", () => {
  it("403s a non-admin — advisors get NO browsable list", async () => {
    (auth as any).mockResolvedValue({ orgId: "firm_1", userId: "u1", orgRole: "org:member" });
    const res = await GET(req(), ctx());
    expect(res.status).toBe(403);
    expect(getHouseholds).not.toHaveBeenCalled();
  });

  it("names the advisor who linked each household", async () => {
    (getHouseholdLinks as any).mockResolvedValue([
      { externalHouseholdId: "1234567", clientId: "c1", linkedByUserId: "u1" },
    ]);
    (resolveActors as any).mockResolvedValue(new Map([["u1", { name: "Dana Advisor" }]]));
    const res = await GET(req(), ctx());
    const body = await res.json();
    expect(body.households[0]).toEqual(
      expect.objectContaining({ linkedClientId: "c1", linkedByName: "Dana Advisor" }),
    );
  });

  it("reports null rather than throwing when the linker cannot be resolved", async () => {
    (getHouseholdLinks as any).mockResolvedValue([
      { externalHouseholdId: "1234567", clientId: "c1", linkedByUserId: null },
    ]);
    const res = await GET(req(), ctx());
    const body = await res.json();
    expect(body.households[0].linkedByName).toBeNull();
    expect(resolveActors).toHaveBeenCalledWith([]);
  });

  it("leaves an unlinked household with no client and no linker", async () => {
    const res = await GET(req(), ctx());
    const body = await res.json();
    expect(body.households[0]).toEqual(
      expect.objectContaining({ linkedClientId: null, linkedByName: null }),
    );
  });
});

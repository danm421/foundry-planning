import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  checkIntegrationSyncLimit: vi.fn(),
  rateLimitErrorResponse: vi.fn(() => new Response(JSON.stringify({ error: "rl" }), { status: 429 })),
}));
vi.mock("@/lib/integrations/sync", () => ({ syncFirm: vi.fn() }));

import { POST } from "./route";
import { auth } from "@clerk/nextjs/server";
import { checkIntegrationSyncLimit } from "@/lib/rate-limit";
import { syncFirm } from "@/lib/integrations/sync";

beforeEach(() => vi.clearAllMocks());

function post(body: unknown = {}) {
  return new Request("https://app.test/api/integrations/orion/sync", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
function ctx(provider = "orion") {
  return { params: Promise.resolve({ provider }) };
}

describe("POST /api/integrations/[provider]/sync", () => {
  it("returns the sync summary for an admin", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (auth as any).mockResolvedValue({ orgId: "firm_1", userId: "u1", orgRole: "org:admin" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (checkIntegrationSyncLimit as any).mockResolvedValue({ allowed: true, remaining: 5, reset: 0 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (syncFirm as any).mockResolvedValue({ committed: 2, queued: 1, importId: "imp_1" });

    const res = await POST(post({ clientId: "c1" }), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ committed: 2, queued: 1, importId: "imp_1" });
    expect(syncFirm).toHaveBeenCalledWith("firm_1", "orion", { trigger: "manual", userId: "u1", clientId: "c1" });
  });

  it("403s a non-admin (does not sync)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (auth as any).mockResolvedValue({ orgId: "firm_1", userId: "u1", orgRole: "org:member" });
    const res = await POST(post(), ctx());
    expect(res.status).toBe(403);
    expect(syncFirm).not.toHaveBeenCalled();
  });

  it("429s when rate-limited (does not sync)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (auth as any).mockResolvedValue({ orgId: "firm_1", userId: "u1", orgRole: "org:admin" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (checkIntegrationSyncLimit as any).mockResolvedValue({ allowed: false, reason: "exceeded", reset: Date.now() + 60000 });
    const res = await POST(post(), ctx());
    expect(res.status).toBe(429);
    expect(syncFirm).not.toHaveBeenCalled();
  });
});

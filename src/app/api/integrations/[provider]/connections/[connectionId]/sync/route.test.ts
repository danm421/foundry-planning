import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/authz", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authz")>();
  return { ...actual, requireActiveSubscriptionForFirm: vi.fn().mockResolvedValue(undefined) };
});
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/integrations/connection-access", () => ({ getOwnedConnection: vi.fn() }));
vi.mock("@/lib/integrations/sync", () => ({ syncConnection: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  checkIntegrationSyncLimit: vi.fn(),
  rateLimitErrorResponse: vi.fn(() => new Response(JSON.stringify({ error: "rl" }), { status: 429 })),
}));

import { POST } from "./route";
import { auth } from "@clerk/nextjs/server";
import { getOwnedConnection } from "@/lib/integrations/connection-access";
import { syncConnection } from "@/lib/integrations/sync";
import { checkIntegrationSyncLimit } from "@/lib/rate-limit";
import { ForbiddenError, requireActiveSubscriptionForFirm } from "@/lib/authz";

/* eslint-disable @typescript-eslint/no-explicit-any */

const CONN = "11111111-1111-4111-8111-111111111111";
const connection = { id: CONN, firmId: "firm_1", providerId: "addepar", ownerUserId: "u1", status: "connected" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ADDEPAR_ENABLED", "true");
  (auth as any).mockResolvedValue({ orgId: "firm_1", userId: "u1", orgRole: "org:member" });
  (getOwnedConnection as any).mockResolvedValue(connection);
  (checkIntegrationSyncLimit as any).mockResolvedValue({ allowed: true });
  (syncConnection as any).mockResolvedValue({ committed: 0, queued: 4, importId: "imp1" });
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const ctx = () => ({ params: Promise.resolve({ provider: "addepar", connectionId: CONN }) });
const post = () =>
  new Request(`https://app.test/api/integrations/addepar/connections/${CONN}/sync`, { method: "POST" });

describe("POST …/connections/[connectionId]/sync", () => {
  it("syncs the owner's connection", async () => {
    const res = await POST(post(), ctx());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ committed: 0, queued: 4, importId: "imp1" });
    expect(getOwnedConnection).toHaveBeenCalledWith({ connectionId: CONN, firmId: "firm_1", userId: "u1" });
    expect(requireActiveSubscriptionForFirm).toHaveBeenCalledWith("firm_1");
    // Per connection, so one advisor's syncing can't 429 a colleague.
    expect(checkIntegrationSyncLimit).toHaveBeenCalledWith(`addepar:${CONN}`);
    // The whole connection: no clientId.
    expect(syncConnection).toHaveBeenCalledWith(CONN, { trigger: "manual", userId: "u1" });
  });

  it("404 for a colleague", async () => {
    (getOwnedConnection as any).mockResolvedValue(null);

    const res = await POST(post(), ctx());

    expect(res.status).toBe(404);
    expect(checkIntegrationSyncLimit).not.toHaveBeenCalled();
    expect(syncConnection).not.toHaveBeenCalled();
  });

  it("409 for a disconnected connection, which has no key to sync with", async () => {
    (getOwnedConnection as any).mockResolvedValue({ ...connection, status: "disconnected" });

    const res = await POST(post(), ctx());

    expect(res.status).toBe(409);
    expect(syncConnection).not.toHaveBeenCalled();
  });

  it("429 once rate limited — nothing synced", async () => {
    (checkIntegrationSyncLimit as any).mockResolvedValue({ allowed: false });

    const res = await POST(post(), ctx());

    expect(res.status).toBe(429);
    expect(syncConnection).not.toHaveBeenCalled();
  });

  it("403 on a lapsed subscription — nothing synced", async () => {
    (requireActiveSubscriptionForFirm as any).mockRejectedValueOnce(
      new ForbiddenError("Active subscription required"),
    );

    const res = await POST(post(), ctx());

    expect(res.status).toBe(403);
    expect(syncConnection).not.toHaveBeenCalled();
  });
});

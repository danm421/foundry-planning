import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  checkIntegrationSyncLimit: vi.fn(),
  rateLimitErrorResponse: vi.fn(() => new Response(JSON.stringify({ error: "rl" }), { status: 429 })),
}));
vi.mock("@/lib/integrations/sync", () => ({ syncFirm: vi.fn() }));
vi.mock("@/lib/clients/authz", () => ({ requireClientEditAccess: vi.fn() }));

import { POST } from "./route";
import { auth } from "@clerk/nextjs/server";
import { checkIntegrationSyncLimit } from "@/lib/rate-limit";
import { syncFirm } from "@/lib/integrations/sync";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { ForbiddenError } from "@/lib/authz";

const ORIGINAL_ORION_ENABLED = process.env.ORION_ENABLED;
beforeEach(() => {
  vi.clearAllMocks();
  process.env.ORION_ENABLED = "true";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (requireClientEditAccess as any).mockResolvedValue({
    client: { id: "c1" }, firmId: "firm_1", access: "own",
  });
});
afterEach(() => {
  if (ORIGINAL_ORION_ENABLED === undefined) delete process.env.ORION_ENABLED;
  else process.env.ORION_ENABLED = ORIGINAL_ORION_ENABLED;
});

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
    // A per-client sync buckets on the USER, not the firm — even for an
    // admin — so one advisor can't spend the firm's whole sync budget.
    expect(checkIntegrationSyncLimit).toHaveBeenCalledWith("orion:u1");
  });

  it("403s a non-admin on a firm-wide sync — client edit access is no substitute", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (auth as any).mockResolvedValue({ orgId: "firm_1", userId: "u1", orgRole: "org:member" });
    const res = await POST(post(), ctx());
    expect(res.status).toBe(403);
    expect(syncFirm).not.toHaveBeenCalled();
    // Proves the 403 came from the admin gate, not from the new
    // access !== "own" branch (which never ran — a firm-wide sync must not
    // consult client access at all).
    expect(requireClientEditAccess).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({ error: "Organization admin role required" });
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

  it("429s a per-client sync when the CALLER's own limit is exceeded", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (auth as any).mockResolvedValue({ orgId: "firm_1", userId: "u1", orgRole: "org:member" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (checkIntegrationSyncLimit as any).mockResolvedValue({ allowed: false, reason: "exceeded", reset: Date.now() + 60000 });
    const res = await POST(post({ clientId: "c1" }), ctx());
    expect(res.status).toBe(429);
    expect(syncFirm).not.toHaveBeenCalled();
    // A wrong key here (e.g. the firm bucket) would let this test pass on
    // symptom alone (still 429) without proving WHICH bucket got spent.
    expect(checkIntegrationSyncLimit).toHaveBeenCalledWith("orion:u1");
  });

  it("lets a NON-ADMIN advisor sync their own client", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (auth as any).mockResolvedValue({ orgId: "firm_1", userId: "u1", orgRole: "org:member" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (checkIntegrationSyncLimit as any).mockResolvedValue({ allowed: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (syncFirm as any).mockResolvedValue({ committed: 0, queued: 2 });
    const res = await POST(post({ clientId: "c1" }), ctx());
    expect(res.status).toBe(200);
    expect(syncFirm).toHaveBeenCalledWith(
      "firm_1", "orion",
      { trigger: "manual", userId: "u1", clientId: "c1" },
    );
    // Buckets on the caller, not the firm — five advisors syncing their own
    // clients in the same minute must not 429 each other or the admin.
    expect(checkIntegrationSyncLimit).toHaveBeenCalledWith("orion:u1");
  });

  it("403s an advisor syncing a client they cannot edit", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (auth as any).mockResolvedValue({ orgId: "firm_1", userId: "u2", orgRole: "org:member" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (requireClientEditAccess as any).mockRejectedValue(new ForbiddenError("Edit access required"));
    const res = await POST(post({ clientId: "c1" }), ctx());
    expect(res.status).toBe(403);
    expect(syncFirm).not.toHaveBeenCalled();
    // Proves this 403 came from the gate REJECTING (caught -> authErrorResponse),
    // not from the access !== "own" branch, which returns a different body.
    await expect(res.json()).resolves.toEqual({ error: "Edit access required" });
  });

  it("403s a cross-firm share — a share is not integration access", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (auth as any).mockResolvedValue({ orgId: "firm_1", userId: "u3", orgRole: "org:member" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (requireClientEditAccess as any).mockResolvedValue({
      client: { id: "c1" }, firmId: "firm_other", access: "shared",
    });
    const res = await POST(post({ clientId: "c1" }), ctx());
    expect(res.status).toBe(403);
    expect(syncFirm).not.toHaveBeenCalled();
    // Proves this 403 came from the access !== "own" branch (gate RESOLVED,
    // then failed the own-firm check), not from a thrown ForbiddenError.
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" });
  });

  it("does NOT consult client access for a firm-wide sync", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (auth as any).mockResolvedValue({ orgId: "firm_1", userId: "admin1", orgRole: "org:admin" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (checkIntegrationSyncLimit as any).mockResolvedValue({ allowed: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (syncFirm as any).mockResolvedValue({ committed: 0, queued: 0 });
    const res = await POST(post({}), ctx());
    expect(res.status).toBe(200);
    expect(requireClientEditAccess).not.toHaveBeenCalled();
    expect(syncFirm).toHaveBeenCalledWith(
      "firm_1", "orion",
      { trigger: "manual", userId: "admin1", clientId: undefined },
    );
    // A firm-wide sync still buckets on the FIRM, unchanged from before the split.
    expect(checkIntegrationSyncLimit).toHaveBeenCalledWith("orion:firm_1");
  });
});

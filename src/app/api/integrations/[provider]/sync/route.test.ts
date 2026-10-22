import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/authz", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authz")>();
  return { ...actual, requireActiveSubscriptionForFirm: vi.fn().mockResolvedValue(undefined) };
});

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  checkIntegrationSyncLimit: vi.fn(),
  rateLimitErrorResponse: vi.fn(() => new Response(JSON.stringify({ error: "rl" }), { status: 429 })),
}));
vi.mock("@/lib/integrations/sync", () => ({ syncConnection: vi.fn() }));
vi.mock("@/lib/integrations/households", () => ({ getHouseholdLinkForClient: vi.fn() }));
vi.mock("@/lib/clients/authz", () => ({ requireClientEditAccess: vi.fn() }));

import { POST } from "./route";
import { auth } from "@clerk/nextjs/server";
import { checkIntegrationSyncLimit } from "@/lib/rate-limit";
import { syncConnection } from "@/lib/integrations/sync";
import { getHouseholdLinkForClient } from "@/lib/integrations/households";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { ForbiddenError } from "@/lib/authz";

const ORIGINAL_ORION_ENABLED = process.env.ORION_ENABLED;
beforeEach(() => {
  vi.clearAllMocks();
  process.env.ORION_ENABLED = "true";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (auth as any).mockResolvedValue({ orgId: "firm_1", userId: "u1", orgRole: "org:member" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (requireClientEditAccess as any).mockResolvedValue({
    client: { id: "c1" }, firmId: "firm_1", access: "own",
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (getHouseholdLinkForClient as any).mockResolvedValue({
    id: "link_1", clientId: "c1", provider: "orion", connectionId: "conn_1",
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (checkIntegrationSyncLimit as any).mockResolvedValue({ allowed: true });
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
  it("400 without clientId", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (auth as any).mockResolvedValue({ orgId: "firm_1", userId: "admin1", orgRole: "org:admin" });
    const res = await POST(post({}), ctx());
    expect(res.status).toBe(400);
    // An admin gets no firm-wide sync either: there is no such branch now.
    expect(syncConnection).not.toHaveBeenCalled();
    expect(requireClientEditAccess).not.toHaveBeenCalled();
  });

  it("404 when the client has no link on this provider", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (getHouseholdLinkForClient as any).mockResolvedValue(null);
    const unlinked = await POST(post({ clientId: "c1" }), ctx());
    expect(unlinked.status).toBe(404);

    // Linked, but through a different provider than the URL names.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (getHouseholdLinkForClient as any).mockResolvedValue({
      id: "link_1", clientId: "c1", provider: "addepar", connectionId: "conn_9",
    });
    const otherProvider = await POST(post({ clientId: "c1" }), ctx());
    expect(otherProvider.status).toBe(404);

    expect(getHouseholdLinkForClient).toHaveBeenCalledWith("c1");
    expect(syncConnection).not.toHaveBeenCalled();
  });

  it("syncs through the link's connection for a same-firm colleague", async () => {
    // The colleague is not the connection's owner; client edit access is what licenses the sync.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (auth as any).mockResolvedValue({ orgId: "firm_1", userId: "colleague", orgRole: "org:member" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (syncConnection as any).mockResolvedValue({ committed: 2, queued: 1, importId: "imp_1" });

    const res = await POST(post({ clientId: "c1" }), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ committed: 2, queued: 1, importId: "imp_1" });
    expect(requireClientEditAccess).toHaveBeenCalledWith("c1");
    expect(syncConnection).toHaveBeenCalledWith("conn_1", {
      trigger: "manual",
      userId: "colleague",
      clientId: "c1",
    });
    // Buckets on the caller, not the firm — five advisors syncing their own
    // clients in the same minute must not 429 each other.
    expect(checkIntegrationSyncLimit).toHaveBeenCalledWith("orion:colleague");
  });

  it("429s a per-client sync when the CALLER's own limit is exceeded", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (checkIntegrationSyncLimit as any).mockResolvedValue({ allowed: false, reason: "exceeded", reset: Date.now() + 60000 });
    const res = await POST(post({ clientId: "c1" }), ctx());
    expect(res.status).toBe(429);
    expect(syncConnection).not.toHaveBeenCalled();
    // A wrong key here (e.g. the firm bucket) would let this test pass on
    // symptom alone (still 429) without proving WHICH bucket got spent.
    expect(checkIntegrationSyncLimit).toHaveBeenCalledWith("orion:u1");
  });

  it("403s an advisor syncing a client they cannot edit", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (requireClientEditAccess as any).mockRejectedValue(new ForbiddenError("Edit access required"));
    const res = await POST(post({ clientId: "c1" }), ctx());
    expect(res.status).toBe(403);
    expect(syncConnection).not.toHaveBeenCalled();
    // Proves this 403 came from the gate REJECTING (caught -> authErrorResponse),
    // not from the access !== "own" branch, which returns a different body.
    await expect(res.json()).resolves.toEqual({ error: "Edit access required" });
  });

  it("403s a cross-firm share — a share is not integration access", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (requireClientEditAccess as any).mockResolvedValue({
      client: { id: "c1" }, firmId: "firm_other", access: "shared",
    });
    const res = await POST(post({ clientId: "c1" }), ctx());
    expect(res.status).toBe(403);
    expect(syncConnection).not.toHaveBeenCalled();
    expect(getHouseholdLinkForClient).not.toHaveBeenCalled();
    // Proves this 403 came from the access !== "own" branch (gate RESOLVED,
    // then failed the own-firm check), not from a thrown ForbiddenError.
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" });
  });
});

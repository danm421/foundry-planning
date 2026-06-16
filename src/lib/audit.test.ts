import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Direct unit tests for `recordAudit` — flagged by the audit (F9) as
 * untested despite being the SOC-2 evidence path. Covers the three
 * behaviors with real failure modes: the deliberate swallow path (audit
 * failure must never break the request), the `actorId` override (for
 * signed-webhook callers), and the `auth().userId` → "system" fallback.
 */

const h = vi.hoisted(() => ({
  values: vi.fn().mockResolvedValue(undefined),
  authUserId: vi.fn(),
  actor: null as { sub: string } | null,
}));

vi.mock("@/db", () => ({
  db: { insert: () => ({ values: h.values }) },
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: h.authUserId(), actor: h.actor }),
}));

import { recordAudit } from "@/lib/audit";

const base = {
  action: "client.create" as const,
  resourceType: "client",
  resourceId: "c1",
  firmId: "f1",
};

beforeEach(() => {
  vi.clearAllMocks();
  h.values.mockResolvedValue(undefined);
  h.authUserId.mockReturnValue("user-1");
  h.actor = null;
});

describe("recordAudit", () => {
  it("inserts a row with the resolved Clerk actor + passed fields", async () => {
    await recordAudit({ ...base, clientId: "c1", metadata: { k: 1 } });
    expect(h.values).toHaveBeenCalledWith(
      expect.objectContaining({
        firmId: "f1",
        actorId: "user-1",
        action: "client.create",
        resourceType: "client",
        resourceId: "c1",
        clientId: "c1",
        metadata: { k: 1 },
      }),
    );
  });

  it("defaults clientId and metadata to null when omitted", async () => {
    await recordAudit(base);
    expect(h.values).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: null, metadata: null }),
    );
  });

  it("uses the actorId override and never calls auth() (webhook path)", async () => {
    await recordAudit({ ...base, actorId: "clerk:webhook" });
    expect(h.values).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: "clerk:webhook" }),
    );
    // `args.actorId ?? (await auth())` short-circuits — auth must not run.
    expect(h.authUserId).not.toHaveBeenCalled();
  });

  it("falls back to 'system' when there is no Clerk user and no override", async () => {
    h.authUserId.mockReturnValue(null);
    await recordAudit(base);
    expect(h.values).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: "system" }),
    );
  });

  it("during impersonation, attributes to the ops actor and stamps the advisor", async () => {
    h.authUserId.mockReturnValue("user_advisor"); // session belongs to the advisor
    h.actor = { sub: "user_ops" }; // minted by the ops operator
    await recordAudit({ ...base, metadata: { k: 1 } });
    expect(h.values).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "user_ops",
        metadata: { k: 1, actingAsAdvisor: "user_advisor" },
      }),
    );
  });

  it("an explicit actorId still wins over the actor claim (and never calls auth())", async () => {
    h.actor = { sub: "user_ops" };
    await recordAudit({ ...base, actorId: "clerk:webhook" });
    expect(h.values).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: "clerk:webhook" }),
    );
    expect(h.authUserId).not.toHaveBeenCalled();
  });

  it("swallows a DB error: resolves without throwing and logs", async () => {
    h.values.mockRejectedValueOnce(new Error("db down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(recordAudit(base)).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalledWith(
      "[audit] failed to record:",
      expect.objectContaining({ action: "client.create" }),
    );
    errSpy.mockRestore();
  });
});

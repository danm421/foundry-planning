import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  create: vi.fn(),
  audits: [] as Array<Record<string, unknown>>,
}));

vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: () => Promise.resolve({ actorTokens: { create: (...a: unknown[]) => h.create(...a) } }),
}));

vi.mock("@/lib/audit", () => ({
  recordAudit: (a: Record<string, unknown>) => {
    h.audits.push(a);
    return Promise.resolve();
  },
}));

import { startImpersonation, recordImpersonationEnded } from "../impersonation";

beforeEach(() => {
  h.create.mockReset().mockResolvedValue({ url: "https://accounts.clerk.test/sign-in?ticket=abc" });
  h.audits = [];
});

describe("startImpersonation", () => {
  it("mints an actor token for the advisor acting as the ops user and returns the URL", async () => {
    const url = await startImpersonation({
      firmId: "org_1",
      advisorUserId: "user_adv",
      opsUserId: "user_op",
      reason: "support ticket 42",
    });
    expect(url).toBe("https://accounts.clerk.test/sign-in?ticket=abc");
    expect(h.create).toHaveBeenCalledWith({
      userId: "user_adv",
      actor: { sub: "user_op" },
      expiresInSeconds: 600,
    });
    expect(h.audits[0]).toMatchObject({
      action: "ops.impersonation.started",
      actorId: "user_op",
      firmId: "org_1",
      resourceType: "user",
      resourceId: "user_adv",
      metadata: expect.objectContaining({ reason: "support ticket 42", advisorUserId: "user_adv" }),
    });
  });

  it("throws when Clerk returns no sign-in URL", async () => {
    h.create.mockResolvedValue({ url: null });
    await expect(
      startImpersonation({ firmId: "org_1", advisorUserId: "user_adv", opsUserId: "user_op", reason: "x" }),
    ).rejects.toThrow(/sign-in URL/i);
  });

  it("audits before it can fail on a missing URL (started is recorded)", async () => {
    h.create.mockResolvedValue({ url: null });
    await expect(
      startImpersonation({ firmId: "org_1", advisorUserId: "user_adv", opsUserId: "user_op", reason: "x" }),
    ).rejects.toThrow();
    expect(h.audits[0]).toMatchObject({ action: "ops.impersonation.started" });
  });
});

describe("recordImpersonationEnded", () => {
  it("audits ops.impersonation.ended attributed to the ops user", async () => {
    await recordImpersonationEnded({ firmId: "org_1", advisorUserId: "user_adv", opsUserId: "user_op" });
    expect(h.audits[0]).toMatchObject({
      action: "ops.impersonation.ended",
      actorId: "user_op",
      firmId: "org_1",
      resourceType: "user",
      resourceId: "user_adv",
    });
  });
});

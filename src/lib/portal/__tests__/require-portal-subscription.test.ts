import { describe, it, expect, vi, beforeEach } from "vitest";

const { ForbiddenError } = vi.hoisted(() => {
  class ForbiddenError extends Error {
    constructor(m?: string) { super(m); this.name = "ForbiddenError"; }
  }
  return { ForbiddenError };
});

const requireActiveSubscriptionForFirmMock = vi.fn();
vi.mock("@/lib/authz", () => ({
  ForbiddenError,
  requireActiveSubscriptionForFirm: (firmId: string) =>
    requireActiveSubscriptionForFirmMock(firmId),
}));

vi.mock("@/db/schema", () => ({ clients: { _name: "clients" } }));
vi.mock("drizzle-orm", () => ({ eq: (...a: unknown[]) => a }));

let firmRow: { firmId: string | null } | null = { firmId: "firm-1" };
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve(firmRow ? [firmRow] : []) }),
      }),
    }),
  },
}));

import { requirePortalActiveSubscription } from "@/lib/portal/require-portal-subscription";

beforeEach(() => {
  requireActiveSubscriptionForFirmMock.mockReset().mockResolvedValue(undefined);
  firmRow = { firmId: "firm-1" };
});

describe("requirePortalActiveSubscription", () => {
  it("resolves the client's firm and gates on it (active → ok)", async () => {
    await expect(requirePortalActiveSubscription("c1")).resolves.toBeUndefined();
    expect(requireActiveSubscriptionForFirmMock).toHaveBeenCalledWith("firm-1");
  });

  it("throws ForbiddenError when the firm subscription is inactive", async () => {
    requireActiveSubscriptionForFirmMock.mockRejectedValue(
      new ForbiddenError("Active subscription required"),
    );
    await expect(requirePortalActiveSubscription("c1")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("fails closed (ForbiddenError) when the client has no firm", async () => {
    firmRow = { firmId: null };
    await expect(requirePortalActiveSubscription("c1")).rejects.toBeInstanceOf(ForbiddenError);
    expect(requireActiveSubscriptionForFirmMock).not.toHaveBeenCalled();
  });

  it("fails closed when the client row is missing", async () => {
    firmRow = null;
    await expect(requirePortalActiveSubscription("ghost")).rejects.toBeInstanceOf(ForbiddenError);
  });
});

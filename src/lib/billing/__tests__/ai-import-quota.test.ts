import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db", () => ({
  db: { select: vi.fn(), execute: vi.fn() },
}));
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: vi.fn(),
}));
vi.mock("@/lib/billing/stripe-client", () => ({
  getStripe: vi.fn(),
}));

import { syncAiImportEntitlement } from "../ai-import-quota";

describe("syncAiImportEntitlement", () => {
  beforeEach(() => vi.clearAllMocks());

  it("pushes entitlements with ai_import when quota remaining and no addon", async () => {
    const { db } = await import("@/db");
    const { clerkClient } = await import("@clerk/nextjs/server");
    const { getStripe } = await import("@/lib/billing/stripe-client");

    (db.select as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      from: () => {
        const where = {
          where: () => ({
            then: (cb: (r: unknown[]) => unknown) =>
              Promise.resolve(
                cb([{ aiImportsUsed: 1, stripeSubscriptionId: "sub_1" }]),
              ),
          }),
        };
        return {
          leftJoin: () => where,
          ...where,
        };
      },
    });
    (getStripe as ReturnType<typeof vi.fn>).mockReturnValue({
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue({
          items: { data: [{ metadata: { kind: "seat" } }] },
        }),
      },
    });
    const updateMeta = vi.fn().mockResolvedValue(undefined);
    (clerkClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      organizations: { updateOrganizationMetadata: updateMeta },
    });

    await syncAiImportEntitlement("org_1");

    expect(updateMeta).toHaveBeenCalledWith(
      "org_1",
      expect.objectContaining({
        publicMetadata: expect.objectContaining({ entitlements: ["ai_import"] }),
      }),
    );
  });

  it("no-ops when firm has no live subscription (founder org case)", async () => {
    const { db } = await import("@/db");
    const { clerkClient } = await import("@clerk/nextjs/server");

    (db.select as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      from: () => {
        const where = {
          where: () => ({
            then: (cb: (r: unknown[]) => unknown) =>
              Promise.resolve(cb([])),
          }),
        };
        return {
          leftJoin: () => where,
          ...where,
        };
      },
    });
    const updateMeta = vi.fn();
    (clerkClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      organizations: { updateOrganizationMetadata: updateMeta },
    });

    await syncAiImportEntitlement("org_no_sub");
    expect(updateMeta).not.toHaveBeenCalled();
  });
});

import { describe, it, expect } from "vitest";
import { adminQuery, getScopedContext } from "../admin-scope";
import type { ActingContext } from "@foundry/auth";

const ctx: ActingContext = {
  actorAdminId: "admin-1",
  role: "support",
  impersonation: {
    sessionId: "sess-1",
    advisorClerkUserId: "user_adv",
    firmId: "firm_99",
  },
};

describe("adminQuery", () => {
  it("makes the context readable inside the callback", async () => {
    const seen = await adminQuery(ctx, async () => getScopedContext());
    expect(seen).toEqual(ctx);
  });

  it("returns undefined outside the callback", () => {
    expect(getScopedContext()).toBeUndefined();
  });

  it("propagates the callback return value", async () => {
    const result = await adminQuery(ctx, async () => 42);
    expect(result).toBe(42);
  });

  it("propagates thrown errors", async () => {
    await expect(
      adminQuery(ctx, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});

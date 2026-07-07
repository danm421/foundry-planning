import { describe, it, expect, vi, beforeEach } from "vitest";

const selectChain = vi.fn();
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => selectChain() }),
      }),
    }),
  },
}));

import {
  loadPortalPrivacy,
  requireAreaShared,
  areaShared,
  AREA_BY_RESOURCE_TYPE,
  DEFAULT_PORTAL_PRIVACY,
} from "@/lib/portal/privacy";
import { ForbiddenError } from "@/lib/authz";

beforeEach(() => selectChain.mockReset());

describe("loadPortalPrivacy", () => {
  it("returns the stored row when present", async () => {
    selectChain.mockResolvedValue([
      { shareTransactions: false, shareBudgets: true, shareRecurrings: false },
    ]);
    await expect(loadPortalPrivacy("c1")).resolves.toEqual({
      shareTransactions: false,
      shareBudgets: true,
      shareRecurrings: false,
    });
  });
  it("defaults to share-everything when no row exists", async () => {
    selectChain.mockResolvedValue([]);
    await expect(loadPortalPrivacy("c1")).resolves.toEqual(DEFAULT_PORTAL_PRIVACY);
  });
});

describe("requireAreaShared", () => {
  it("is a no-op for client mode (never queries)", async () => {
    await expect(requireAreaShared("client", "c1", "transactions")).resolves.toBeUndefined();
    expect(selectChain).not.toHaveBeenCalled();
  });
  it("passes for advisor mode when the area is shared", async () => {
    selectChain.mockResolvedValue([
      { shareTransactions: true, shareBudgets: false, shareRecurrings: true },
    ]);
    await expect(requireAreaShared("advisor", "c1", "transactions")).resolves.toBeUndefined();
  });
  it("throws ForbiddenError for advisor mode when the area is off", async () => {
    selectChain.mockResolvedValue([
      { shareTransactions: true, shareBudgets: false, shareRecurrings: true },
    ]);
    await expect(requireAreaShared("advisor", "c1", "budgets")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
  it("passes for advisor mode when no settings row exists (default open)", async () => {
    selectChain.mockResolvedValue([]);
    await expect(requireAreaShared("advisor", "c1", "recurrings")).resolves.toBeUndefined();
  });
});

describe("areaShared / AREA_BY_RESOURCE_TYPE", () => {
  it("maps each area to its flag", () => {
    const p = { shareTransactions: false, shareBudgets: true, shareRecurrings: false };
    expect(areaShared(p, "transactions")).toBe(false);
    expect(areaShared(p, "budgets")).toBe(true);
    expect(areaShared(p, "recurrings")).toBe(false);
  });
  it("covers the budgeting resourceTypes the portal routes audit", () => {
    expect(AREA_BY_RESOURCE_TYPE["plaid_transaction"]).toBe("transactions");
    expect(AREA_BY_RESOURCE_TYPE["budget"]).toBe("budgets");
    expect(AREA_BY_RESOURCE_TYPE["transaction_category"]).toBe("budgets");
    expect(AREA_BY_RESOURCE_TYPE["transaction_rule"]).toBe("budgets");
    expect(AREA_BY_RESOURCE_TYPE["recurring_transaction"]).toBe("recurrings");
    // Non-budgeting types stay visible in the activity feed.
    expect(AREA_BY_RESOURCE_TYPE["account"]).toBeUndefined();
    expect(AREA_BY_RESOURCE_TYPE["plaid_item"]).toBeUndefined();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/billing/stripe-client", () => ({ getStripe: vi.fn() }));
vi.mock("@/lib/billing/price-catalog", () => ({
  getPriceCatalog: () => ({
    seatMonthly: "price_monthly",
    seatAnnual: "price_annual",
    seatFoundingAnnual: "price_founding",
  }),
}));
vi.mock("@/db", () => ({ db: { select: vi.fn() } }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

import { readPlanSwitchState } from "../plan-switch";
import { getStripe } from "@/lib/billing/stripe-client";
import { db } from "@/db";

function mockRow(row: Record<string, unknown> | undefined) {
  vi.mocked(db.select).mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue(row ? [row] : []),
      }),
    }),
  } as never);
}

const SEAT = {
  id: "si_1",
  quantity: 1,
  price: { id: "price_annual", unit_amount: 199000, currency: "usd" },
  current_period_start: 1789000000,
  current_period_end: 1820536000,
};

function stripeWith(subscription: Record<string, unknown>) {
  vi.mocked(getStripe).mockReturnValue({
    subscriptions: { retrieve: vi.fn().mockResolvedValue(subscription) },
  } as never);
}

describe("readPlanSwitchState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRow({ stripeSubscriptionId: "sub_1", stripeCustomerId: "cus_1", status: "active" });
  });

  it("reports no pending change when no schedule owns the subscription", async () => {
    stripeWith({ status: "active", items: { data: [SEAT] }, schedule: null, trial_end: null });
    const state = await readPlanSwitchState("org_1");
    expect(state.kind).toBe("none");
    if (state.kind === "none") expect(state.currentPlan).toBe("annual");
  });

  it("reports the pending change from the schedule's FUTURE phase", async () => {
    stripeWith({
      status: "active",
      trial_end: null,
      items: { data: [SEAT] },
      schedule: {
        id: "sub_sched_1",
        phases: [
          { start_date: 1789000000, end_date: 1820536000, items: [{ price: "price_annual", quantity: 1 }] },
          { start_date: 1820536000, end_date: 1823214400, items: [{ price: "price_monthly", quantity: 1 }] },
        ],
      },
    });
    const state = await readPlanSwitchState("org_1");
    expect(state.kind).toBe("pending");
    if (state.kind === "pending") {
      expect(state.targetPlan).toBe("monthly");
      expect(state.scheduleId).toBe("sub_sched_1");
      expect(state.effectiveAt).toEqual(new Date(1820536000 * 1000));
    }
  });

  it("treats a schedule with no future phase as nothing pending", async () => {
    stripeWith({
      status: "active",
      trial_end: null,
      items: { data: [SEAT] },
      schedule: {
        id: "sub_sched_2",
        phases: [
          { start_date: 1700000000, end_date: 1710000000, items: [{ price: "price_annual", quantity: 1 }] },
        ],
      },
    });
    const state = await readPlanSwitchState("org_1");
    expect(state.kind).toBe("none");
  });

  it("is unavailable — never a guess — when Stripe cannot be reached", async () => {
    vi.mocked(getStripe).mockReturnValue({
      subscriptions: { retrieve: vi.fn().mockRejectedValue(new Error("stripe down")) },
    } as never);
    const state = await readPlanSwitchState("org_1");
    expect(state.kind).toBe("unavailable");
  });

  it("is unavailable when the firm has no subscription row", async () => {
    mockRow(undefined);
    const state = await readPlanSwitchState("org_1");
    expect(state.kind).toBe("unavailable");
  });
});

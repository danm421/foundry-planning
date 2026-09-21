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

import { cancelPendingPlanSwitch } from "../plan-switch";
import { getStripe } from "@/lib/billing/stripe-client";
import { db } from "@/db";
import { recordAudit } from "@/lib/audit";

const PERIOD_END = 1820536000;

function mockRow() {
  vi.mocked(db.select).mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi
          .fn()
          .mockResolvedValue([
            { stripeSubscriptionId: "sub_1", stripeCustomerId: "cus_1", status: "active" },
          ]),
      }),
    }),
  } as never);
}

const PENDING = {
  id: "sub_1",
  status: "active",
  trial_end: null,
  items: {
    data: [
      {
        id: "si_1",
        quantity: 1,
        price: { id: "price_annual", unit_amount: 199000, currency: "usd" },
        current_period_end: PERIOD_END,
      },
    ],
  },
  schedule: {
    id: "sub_sched_1",
    phases: [
      { start_date: 1789000000, end_date: PERIOD_END, items: [{ price: "price_annual", quantity: 1 }] },
      { start_date: PERIOD_END, end_date: 1823214400, items: [{ price: "price_monthly", quantity: 1 }] },
    ],
  },
};

describe("cancelPendingPlanSwitch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRow();
  });

  it("releases the schedule and confirms it is gone", async () => {
    const release = vi.fn().mockResolvedValue({ id: "sub_sched_1", status: "released" });
    const retrieve = vi
      .fn()
      .mockResolvedValueOnce(PENDING)
      .mockResolvedValueOnce({ ...PENDING, schedule: null });
    vi.mocked(getStripe).mockReturnValue({
      subscriptions: { retrieve },
      subscriptionSchedules: { release },
    } as never);

    expect(await cancelPendingPlanSwitch("org_1")).toEqual({ ok: true });
    expect(release).toHaveBeenCalledWith("sub_sched_1");
    expect(vi.mocked(recordAudit)).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          flow: "plan_switch_canceled",
          released_schedule: "sub_sched_1",
        }),
      }),
    );
  });

  it("reports failure when the schedule is still attached after the release", async () => {
    vi.mocked(getStripe).mockReturnValue({
      subscriptions: { retrieve: vi.fn().mockResolvedValue(PENDING) },
      subscriptionSchedules: { release: vi.fn().mockResolvedValue({}) },
    } as never);

    expect(await cancelPendingPlanSwitch("org_1")).toEqual({ ok: false });
    expect(vi.mocked(recordAudit)).not.toHaveBeenCalled();
  });

  it("is a no-op success when nothing is pending", async () => {
    const release = vi.fn();
    vi.mocked(getStripe).mockReturnValue({
      subscriptions: { retrieve: vi.fn().mockResolvedValue({ ...PENDING, schedule: null }) },
      subscriptionSchedules: { release },
    } as never);

    expect(await cancelPendingPlanSwitch("org_1")).toEqual({ ok: true });
    expect(release).not.toHaveBeenCalled();
  });
});

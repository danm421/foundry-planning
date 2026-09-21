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

import { commitPlanSwitch } from "../plan-switch";
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

function seat(priceId: string) {
  return {
    id: "si_1",
    quantity: 1,
    price: { id: priceId, unit_amount: 199000, currency: "usd" },
    current_period_start: 1789000000,
    current_period_end: PERIOD_END,
  };
}

const MONTHLY_PRICE = {
  id: "price_monthly",
  unit_amount: 19900,
  currency: "usd",
  recurring: { interval: "month", interval_count: 1 },
};

describe("commitPlanSwitch — paid", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRow();
  });

  it("builds a two-phase schedule that releases, and changes nothing today", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "sub_sched_1",
      phases: [
        { start_date: 1789000000, end_date: PERIOD_END, items: [{ price: "price_annual", quantity: 1 }] },
      ],
    });
    const update = vi.fn().mockResolvedValue({
      id: "sub_sched_1",
      end_behavior: "release",
      phases: [
        { start_date: 1789000000, end_date: PERIOD_END, items: [{ price: "price_annual", quantity: 1 }] },
        { start_date: PERIOD_END, end_date: 1823214400, items: [{ price: "price_monthly", quantity: 1 }] },
      ],
    });
    vi.mocked(getStripe).mockReturnValue({
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue({
          id: "sub_1",
          status: "active",
          items: { data: [seat("price_annual")] },
          schedule: null,
          trial_end: null,
        }),
      },
      prices: { retrieve: vi.fn().mockResolvedValue(MONTHLY_PRICE) },
      subscriptionSchedules: { create, update, release: vi.fn() },
    } as never);

    const result = await commitPlanSwitch("org_1", "monthly");

    expect(result).toMatchObject({ ok: true, mode: "scheduled", plan: "monthly" });
    const params = update.mock.calls[0][1];
    expect(params.end_behavior).toBe("release");
    expect(params.proration_behavior).toBe("none");
    expect(params.phases).toHaveLength(2);
    // The running phase is handed back exactly as Stripe reported it.
    expect(params.phases[0]).toMatchObject({ start_date: 1789000000, end_date: PERIOD_END });
    // `iterations` was removed from schedule phases — duration is the parameter.
    expect(params.phases[1]).not.toHaveProperty("iterations");
    expect(params.phases[1].duration).toEqual({ interval: "month", interval_count: 1 });
  });

  it("derives the effective date from STRIPE'S phase, not from the request", async () => {
    const STRIPE_SAYS = 1899999999; // deliberately not the period end above
    vi.mocked(getStripe).mockReturnValue({
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue({
          id: "sub_1",
          status: "active",
          items: { data: [seat("price_annual")] },
          schedule: null,
          trial_end: null,
        }),
      },
      prices: { retrieve: vi.fn().mockResolvedValue(MONTHLY_PRICE) },
      subscriptionSchedules: {
        create: vi.fn().mockResolvedValue({
          id: "sub_sched_1",
          phases: [
            { start_date: 1789000000, end_date: PERIOD_END, items: [{ price: "price_annual", quantity: 1 }] },
          ],
        }),
        update: vi.fn().mockResolvedValue({
          id: "sub_sched_1",
          end_behavior: "release",
          phases: [
            { start_date: 1789000000, end_date: STRIPE_SAYS, items: [{ price: "price_annual", quantity: 1 }] },
            { start_date: STRIPE_SAYS, end_date: 1999999999, items: [{ price: "price_monthly", quantity: 1 }] },
          ],
        }),
        release: vi.fn(),
      },
    } as never);

    const result = await commitPlanSwitch("org_1", "monthly");

    expect(result).toMatchObject({ ok: true, effectiveAt: new Date(STRIPE_SAYS * 1000) });
    expect(vi.mocked(recordAudit)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "billing.subscription_updated",
        metadata: expect.objectContaining({
          flow: "plan_switch_scheduled",
          effective_at: new Date(STRIPE_SAYS * 1000).toISOString(),
        }),
      }),
    );
  });

  it("refuses when a change is already pending", async () => {
    vi.mocked(getStripe).mockReturnValue({
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue({
          id: "sub_1",
          status: "active",
          trial_end: null,
          items: { data: [seat("price_annual")] },
          schedule: {
            id: "sub_sched_9",
            phases: [
              { start_date: 1789000000, end_date: PERIOD_END, items: [{ price: "price_annual", quantity: 1 }] },
              { start_date: PERIOD_END, end_date: 1823214400, items: [{ price: "price_monthly", quantity: 1 }] },
            ],
          },
        }),
      },
      prices: { retrieve: vi.fn() },
      subscriptionSchedules: { create: vi.fn(), update: vi.fn(), release: vi.fn() },
    } as never);

    expect(await commitPlanSwitch("org_1", "monthly")).toEqual({
      ok: false,
      reason: "pending_exists",
    });
  });

  it("refuses a subscription that is already cancelling", async () => {
    vi.mocked(getStripe).mockReturnValue({
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue({
          id: "sub_1",
          status: "active",
          cancel_at_period_end: true,
          trial_end: null,
          items: { data: [seat("price_annual")] },
          schedule: null,
        }),
      },
      prices: { retrieve: vi.fn() },
      subscriptionSchedules: { create: vi.fn(), update: vi.fn(), release: vi.fn() },
    } as never);

    expect(await commitPlanSwitch("org_1", "monthly")).toEqual({
      ok: false,
      reason: "not_switchable",
    });
  });
});

describe("commitPlanSwitch — trial", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRow();
  });

  it("swaps the item immediately, holds the trial end, and creates no schedule", async () => {
    const update = vi.fn().mockResolvedValue({
      status: "trialing",
      trial_end: 1791000000,
      items: { data: [seat("price_monthly")] },
      schedule: null,
    });
    const create = vi.fn();
    vi.mocked(getStripe).mockReturnValue({
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue({
          id: "sub_1",
          status: "trialing",
          trial_end: 1791000000,
          items: { data: [seat("price_annual")] },
          schedule: null,
        }),
        update,
      },
      prices: { retrieve: vi.fn().mockResolvedValue(MONTHLY_PRICE) },
      subscriptionSchedules: { create, update: vi.fn(), release: vi.fn() },
    } as never);

    const result = await commitPlanSwitch("org_1", "monthly");

    expect(result).toMatchObject({ ok: true, mode: "immediate", plan: "monthly" });
    expect(update.mock.calls[0][1].proration_behavior).toBe("none");
    expect(update.mock.calls[0][1]).not.toHaveProperty("trial_end");
    expect(create).not.toHaveBeenCalled();
  });
});

/**
 * The whole point of this module is that it reports what Stripe did. If Stripe
 * comes back with something we cannot name, saying "you're on monthly now"
 * because monthly is what we asked for is the original bug in miniature.
 */
describe("commitPlanSwitch — never reports what it cannot read back", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRow();
  });

  it("refuses when the landed schedule phase carries an unrecognised price", async () => {
    vi.mocked(getStripe).mockReturnValue({
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue({
          id: "sub_1",
          status: "active",
          items: { data: [seat("price_annual")] },
          schedule: null,
          trial_end: null,
        }),
      },
      prices: { retrieve: vi.fn().mockResolvedValue(MONTHLY_PRICE) },
      subscriptionSchedules: {
        create: vi.fn().mockResolvedValue({
          id: "sub_sched_1",
          phases: [
            { start_date: 1789000000, end_date: PERIOD_END, items: [{ price: "price_annual", quantity: 1 }] },
          ],
        }),
        update: vi.fn().mockResolvedValue({
          id: "sub_sched_1",
          end_behavior: "release",
          phases: [
            { start_date: 1789000000, end_date: PERIOD_END, items: [{ price: "price_annual", quantity: 1 }] },
            { start_date: PERIOD_END, end_date: 1823214400, items: [{ price: "price_something_else", quantity: 1 }] },
          ],
        }),
        release: vi.fn(),
      },
    } as never);

    expect(await commitPlanSwitch("org_1", "monthly")).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(vi.mocked(recordAudit)).not.toHaveBeenCalled();
  });

  it("refuses a trial swap that did not land on the price we asked for", async () => {
    vi.mocked(getStripe).mockReturnValue({
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue({
          id: "sub_1",
          status: "trialing",
          trial_end: 1791000000,
          items: { data: [seat("price_annual")] },
          schedule: null,
        }),
        update: vi.fn().mockResolvedValue({
          status: "trialing",
          trial_end: 1791000000,
          items: { data: [seat("price_something_else")] },
          schedule: null,
        }),
      },
      prices: { retrieve: vi.fn().mockResolvedValue(MONTHLY_PRICE) },
      subscriptionSchedules: { create: vi.fn(), update: vi.fn(), release: vi.fn() },
    } as never);

    expect(await commitPlanSwitch("org_1", "monthly")).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("refuses a target price with no recurring interval instead of guessing monthly", async () => {
    const create = vi.fn();
    vi.mocked(getStripe).mockReturnValue({
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue({
          id: "sub_1",
          status: "active",
          items: { data: [seat("price_annual")] },
          schedule: null,
          trial_end: null,
        }),
      },
      prices: {
        retrieve: vi
          .fn()
          .mockResolvedValue({ id: "price_monthly", unit_amount: 19900, currency: "usd", recurring: null }),
      },
      subscriptionSchedules: { create, update: vi.fn(), release: vi.fn() },
    } as never);

    expect(await commitPlanSwitch("org_1", "monthly")).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(create).not.toHaveBeenCalled();
  });
});

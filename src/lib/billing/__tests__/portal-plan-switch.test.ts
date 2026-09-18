import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/billing/price-catalog", () => ({
  getPriceCatalog: () => ({
    seatMonthly: "price_monthly",
    seatAnnual: "price_annual",
    seatFoundingAnnual: "price_founding",
  }),
}));

import { getPlanSwitchPortalConfigurationId } from "../portal-plan-switch";

const retrieve = vi.fn();
const list = vi.fn();
const create = vi.fn();
const update = vi.fn();

function stripe() {
  return {
    prices: { retrieve },
    billingPortal: { configurations: { list, create, update } },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  retrieve.mockImplementation(async (id: string) => ({
    id,
    product: "prod_seat",
  }));
  list.mockResolvedValue({ data: [] });
  create.mockResolvedValue({ id: "bpc_new" });
});

describe("getPlanSwitchPortalConfigurationId", () => {
  it("creates a price-switch configuration that preserves free trials", async () => {
    await expect(
      getPlanSwitchPortalConfigurationId(stripe(), { deferToPeriodEnd: true }),
    ).resolves.toBe("bpc_new");

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      metadata: { purpose: "foundry_plan_switch_v1" },
      features: {
        payment_method_update: { enabled: true },
        subscription_update: expect.objectContaining({
          enabled: true,
          default_allowed_updates: ["price"],
          trial_update_behavior: "continue_trial",
          proration_behavior: "none",
          products: [{
            product: "prod_seat",
            prices: ["price_monthly", "price_annual"],
            adjustable_quantity: { enabled: false },
          }],
        }),
      },
    }));
  });

  it("updates and reuses the app-owned configuration", async () => {
    list.mockResolvedValue({
      data: [{ id: "bpc_existing", metadata: { purpose: "foundry_plan_switch_v1" } }],
    });
    update.mockResolvedValue({ id: "bpc_existing" });

    await expect(
      getPlanSwitchPortalConfigurationId(stripe(), { deferToPeriodEnd: true }),
    ).resolves.toBe("bpc_existing");
    expect(update).toHaveBeenCalledWith(
      "bpc_existing",
      expect.objectContaining({
        features: expect.objectContaining({ subscription_update: expect.any(Object) }),
      }),
    );
    expect(create).not.toHaveBeenCalled();
  });

  /**
   * A paid annual customer has already bought the whole year. Applying the
   * downgrade now would re-anchor their renewal one month out and bin the rest
   * of what they paid for, so the update waits for the period they own to end.
   */
  it("defers a downgrade when there is a paid period to protect", async () => {
    await getPlanSwitchPortalConfigurationId(stripe(), { deferToPeriodEnd: true });

    const features = create.mock.calls[0][0].features;
    expect(features.subscription_update.schedule_at_period_end).toEqual({
      conditions: [
        { type: "decreasing_item_amount" },
        { type: "shortening_interval" },
      ],
    });
  });

  /**
   * A trial has bought nothing, so there is nothing to defer for: scheduling
   * the switch instead of making it is what made "Switch to monthly" look
   * like a dead button — the page kept reading Annual until the trial ended.
   */
  it("applies the switch immediately when nothing has been paid for", async () => {
    await expect(
      getPlanSwitchPortalConfigurationId(stripe(), { deferToPeriodEnd: false }),
    ).resolves.toBe("bpc_new");

    const params = create.mock.calls[0][0];
    expect(params.metadata).toEqual({ purpose: "foundry_plan_switch_immediate_v1" });
    expect(params.features.subscription_update).not.toHaveProperty(
      "schedule_at_period_end",
    );
    expect(params.features.subscription_update.trial_update_behavior).toBe(
      "continue_trial",
    );
  });

  it("never reuses the deferring configuration for an immediate switch", async () => {
    list.mockResolvedValue({
      data: [{ id: "bpc_existing", metadata: { purpose: "foundry_plan_switch_v1" } }],
    });

    await expect(
      getPlanSwitchPortalConfigurationId(stripe(), { deferToPeriodEnd: false }),
    ).resolves.toBe("bpc_new");
    expect(update).not.toHaveBeenCalled();
  });
});

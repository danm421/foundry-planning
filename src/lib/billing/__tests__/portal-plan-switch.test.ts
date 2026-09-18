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
    await expect(getPlanSwitchPortalConfigurationId(stripe())).resolves.toBe("bpc_new");

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      metadata: { purpose: "foundry_plan_switch_v1" },
      features: {
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

    await expect(getPlanSwitchPortalConfigurationId(stripe())).resolves.toBe("bpc_existing");
    expect(update).toHaveBeenCalledWith(
      "bpc_existing",
      expect.objectContaining({
        features: expect.objectContaining({ subscription_update: expect.any(Object) }),
      }),
    );
    expect(create).not.toHaveBeenCalled();
  });
});

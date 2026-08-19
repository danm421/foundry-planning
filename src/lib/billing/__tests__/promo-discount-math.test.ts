import { describe, it, expect } from "vitest";
import {
  applyDiscountCents,
  assertDiscountLeavesSomethingToPay,
  plansInProducts,
  previewDiscount,
  type PlanPrice,
} from "../promo-discount-math";

// The real Foundry prices, one Stripe product each — the split that makes a
// discount aimable at an interval. The spread between them is the whole problem:
// a discount sized for the annual plan is larger than the monthly plan's price.
const MONTHLY = "prod_seat_monthly";
const ANNUAL = "prod_seat_annual";
const FOUNDING = "prod_seat_founding";

const PLANS: PlanPrice[] = [
  { key: "seatMonthly", label: "Monthly", unitAmountCents: 19_900, productId: MONTHLY },
  { key: "seatAnnual", label: "Annual", unitAmountCents: 199_000, productId: ANNUAL },
  {
    key: "seatFoundingAnnual",
    label: "Founding annual",
    unitAmountCents: 178_800,
    productId: FOUNDING,
  },
];

describe("applyDiscountCents", () => {
  it("takes a flat amount off", () => {
    expect(applyDiscountCents({ kind: "amount", amountOffCents: 20_000 }, 199_000)).toBe(179_000);
  });

  it("takes a percentage off", () => {
    expect(applyDiscountCents({ kind: "percent", percentOff: 25 }, 19_900)).toBe(14_925);
  });

  // Stripe drops the remainder of an oversized discount rather than crediting
  // it, so the honest answer is $0 — a free invoice, not a $1 refund.
  it("clamps at zero instead of going negative", () => {
    expect(applyDiscountCents({ kind: "amount", amountOffCents: 20_000 }, 19_900)).toBe(0);
  });

  it("rounds a percentage to the cent", () => {
    expect(applyDiscountCents({ kind: "percent", percentOff: 33 }, 19_900)).toBe(13_333);
  });
});

describe("previewDiscount", () => {
  it("prices every plan with the discount on it", () => {
    expect(previewDiscount({ kind: "percent", percentOff: 10 }, PLANS)).toEqual([
      {
        key: "seatMonthly",
        label: "Monthly",
        unitAmountCents: 19_900,
        productId: MONTHLY,
        afterCents: 17_910,
      },
      {
        key: "seatAnnual",
        label: "Annual",
        unitAmountCents: 199_000,
        productId: ANNUAL,
        afterCents: 179_100,
      },
      {
        key: "seatFoundingAnnual",
        label: "Founding annual",
        unitAmountCents: 178_800,
        productId: FOUNDING,
        afterCents: 160_920,
      },
    ]);
  });

  // The case that shipped: sized for annual, catastrophic on monthly.
  it("shows a $200 discount emptying the monthly plan while the annual one is fine", () => {
    const rows = previewDiscount({ kind: "amount", amountOffCents: 20_000 }, PLANS);
    expect(rows.find((r) => r.key === "seatMonthly")?.afterCents).toBe(0);
    expect(rows.find((r) => r.key === "seatAnnual")?.afterCents).toBe(179_000);
  });
});

describe("plansInProducts", () => {
  it("keeps only the plans belonging to the selected products", () => {
    expect(plansInProducts(PLANS, [ANNUAL]).map((p) => p.key)).toEqual(["seatAnnual"]);
  });

  it("keeps several", () => {
    expect(plansInProducts(PLANS, [ANNUAL, FOUNDING]).map((p) => p.key)).toEqual([
      "seatAnnual",
      "seatFoundingAnnual",
    ]);
  });

  it("returns nothing when nothing is selected", () => {
    expect(plansInProducts(PLANS, [])).toEqual([]);
  });

  it("ignores a product id that matches no plan", () => {
    expect(plansInProducts(PLANS, ["prod_gone"])).toEqual([]);
  });

  // Two prices under one product cannot be discounted apart — Stripe's
  // applies_to takes products, not prices. Selecting the product must therefore
  // take BOTH, so the caller can never believe it split them.
  it("takes every plan sharing a selected product, not just one", () => {
    const shared: PlanPrice[] = [
      { key: "a", label: "Annual", unitAmountCents: 199_000, productId: ANNUAL },
      { key: "b", label: "Founding annual", unitAmountCents: 178_800, productId: ANNUAL },
    ];
    expect(plansInProducts(shared, [ANNUAL]).map((p) => p.key)).toEqual(["a", "b"]);
  });
});

describe("assertDiscountLeavesSomethingToPay", () => {
  it("passes a flat discount under the cheapest plan", () => {
    expect(() =>
      assertDiscountLeavesSomethingToPay({ kind: "amount", amountOffCents: 19_899 }, PLANS),
    ).not.toThrow();
  });

  it("rejects a flat discount that exceeds the cheapest plan", () => {
    expect(() =>
      assertDiscountLeavesSomethingToPay({ kind: "amount", amountOffCents: 20_000 }, PLANS),
    ).toThrow(/Monthly/);
  });

  // A discount exactly equal to the price already bills $0 — the boundary
  // belongs on the rejecting side.
  it("rejects a flat discount equal to the cheapest plan", () => {
    expect(() =>
      assertDiscountLeavesSomethingToPay({ kind: "amount", amountOffCents: 19_900 }, PLANS),
    ).toThrow(/would bill \$0/);
  });

  it("names the cheapest plan's price, which is the ceiling to type", () => {
    expect(() =>
      assertDiscountLeavesSomethingToPay({ kind: "amount", amountOffCents: 20_000 }, PLANS),
    ).toThrow(/\$199\.00/);
  });

  it("points at a percentage as the way to discount across plans", () => {
    expect(() =>
      assertDiscountLeavesSomethingToPay({ kind: "amount", amountOffCents: 20_000 }, PLANS),
    ).toThrow(/percentage/);
  });

  it("accepts 99% off", () => {
    expect(() =>
      assertDiscountLeavesSomethingToPay({ kind: "percent", percentOff: 99 }, PLANS),
    ).not.toThrow();
  });

  it("rejects 100% off", () => {
    expect(() =>
      assertDiscountLeavesSomethingToPay({ kind: "percent", percentOff: 100 }, PLANS),
    ).toThrow(/less than 100%/);
  });

  // Names every plan it would zero, not just the first — otherwise fixing the
  // named one surfaces the next as a fresh surprise.
  it("names every plan the discount would zero", () => {
    const twoPlans: PlanPrice[] = [
      { key: "a", label: "Monthly", unitAmountCents: 19_900, productId: MONTHLY },
      { key: "b", label: "Quarterly", unitAmountCents: 20_000, productId: ANNUAL },
    ];
    expect(() =>
      assertDiscountLeavesSomethingToPay({ kind: "amount", amountOffCents: 25_000 }, twoPlans),
    ).toThrow(/Monthly and Quarterly/);
  });

  // Without prices there is no floor to check against, and assuming one is how
  // the original bug got through.
  it("refuses rather than waving a discount through when no prices are known", () => {
    expect(() =>
      assertDiscountLeavesSomethingToPay({ kind: "amount", amountOffCents: 100 }, []),
    ).toThrow(/could not read the plan prices/i);
  });

  // A price change must move the ceiling on its own — the check reads prices
  // rather than carrying a copy of them.
  it("follows the prices it is given rather than a fixed ceiling", () => {
    const cheaper: PlanPrice[] = [
      { key: "a", label: "Monthly", unitAmountCents: 9_900, productId: MONTHLY },
    ];
    expect(() =>
      assertDiscountLeavesSomethingToPay({ kind: "amount", amountOffCents: 15_000 }, cheaper),
    ).toThrow(/\$99\.00/);
  });

  // The capability the split exists to restore: $200 off is fine on annual, and
  // monthly is untouchable because the coupon cannot reach it.
  it("allows $200 off once monthly is out of scope", () => {
    const annualOnly = plansInProducts(PLANS, [ANNUAL]);
    expect(() =>
      assertDiscountLeavesSomethingToPay({ kind: "amount", amountOffCents: 20_000 }, annualOnly),
    ).not.toThrow();
  });

  it("still refuses $200 off while monthly is in scope", () => {
    const withMonthly = plansInProducts(PLANS, [ANNUAL, MONTHLY]);
    expect(() =>
      assertDiscountLeavesSomethingToPay({ kind: "amount", amountOffCents: 20_000 }, withMonthly),
    ).toThrow(/Monthly/);
  });

  it("still refuses a discount that empties the plan it is aimed at", () => {
    const annualOnly = plansInProducts(PLANS, [ANNUAL]);
    expect(() =>
      assertDiscountLeavesSomethingToPay({ kind: "amount", amountOffCents: 200_000 }, annualOnly),
    ).toThrow(/Annual/);
  });

  // The ceiling quoted must be the cheapest IN SCOPE, or it tells the operator
  // to type a number their own selection has already made safe.
  it("quotes the cheapest plan in scope, not the cheapest overall", () => {
    const annualOnly = plansInProducts(PLANS, [ANNUAL]);
    expect(() =>
      assertDiscountLeavesSomethingToPay({ kind: "amount", amountOffCents: 200_000 }, annualOnly),
    ).toThrow(/\$1,990\.00/);
  });
});

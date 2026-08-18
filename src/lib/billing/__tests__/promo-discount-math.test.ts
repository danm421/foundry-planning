import { describe, it, expect } from "vitest";
import {
  applyDiscountCents,
  assertDiscountLeavesSomethingToPay,
  previewDiscount,
  type SeatPlanPrice,
} from "../promo-discount-math";

// The real Foundry seat prices. The spread between them is the whole problem:
// a discount sized for the annual plan is larger than the monthly plan's price.
const PLANS: SeatPlanPrice[] = [
  { key: "seatMonthly", label: "Monthly", unitAmountCents: 19_900 },
  { key: "seatAnnual", label: "Annual", unitAmountCents: 199_000 },
  { key: "seatFoundingAnnual", label: "Founding annual", unitAmountCents: 178_800 },
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
      { key: "seatMonthly", label: "Monthly", unitAmountCents: 19_900, afterCents: 17_910 },
      { key: "seatAnnual", label: "Annual", unitAmountCents: 199_000, afterCents: 179_100 },
      {
        key: "seatFoundingAnnual",
        label: "Founding annual",
        unitAmountCents: 178_800,
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
    const twoPlans: SeatPlanPrice[] = [
      { key: "a", label: "Monthly", unitAmountCents: 19_900 },
      { key: "b", label: "Quarterly", unitAmountCents: 20_000 },
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
    const cheaper: SeatPlanPrice[] = [{ key: "a", label: "Monthly", unitAmountCents: 9_900 }];
    expect(() =>
      assertDiscountLeavesSomethingToPay({ kind: "amount", amountOffCents: 15_000 }, cheaper),
    ).toThrow(/\$99\.00/);
  });
});

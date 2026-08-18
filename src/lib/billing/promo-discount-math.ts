/**
 * The arithmetic behind a promo code: what a discount leaves a buyer paying on
 * each plan it can reach.
 *
 * Kept apart from `promo-codes.ts` because that module imports the Stripe
 * client. The ops form needs this maths in the browser to preview a code before
 * it exists, and a value import of `promo-codes.ts` would drag the Stripe SDK
 * into the client bundle with it.
 */

export type PromoDiscount =
  | { kind: "percent"; percentOff: number }
  | { kind: "amount"; amountOffCents: number };

/** One price a buyer can be billed at, as Stripe holds it. */
export type SeatPlanPrice = {
  /** Price-catalog key — `seatMonthly`, `seatAnnual`, `seatFoundingAnnual`. */
  key: string;
  /** What ops calls it: "Monthly", "Annual". */
  label: string;
  unitAmountCents: number;
};

export type PlanDiscountPreview = SeatPlanPrice & {
  /** What the plan bills once the discount is applied. Never negative. */
  afterCents: number;
};

/** Foundry prices are USD-only (see docs/stripe-price-setup-checklist.md). */
export function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

/**
 * The cheapest plan a discount can land on — the one that decides the ceiling.
 *
 * Shared so the form's input cap and the server's refusal message are the same
 * rule rather than two copies of it that could drift apart and offer a discount
 * the server then rejects.
 */
export function cheapestPlanCents(plans: SeatPlanPrice[]): number {
  return Math.min(...plans.map((p) => p.unitAmountCents));
}

/**
 * What one plan bills with the discount on it.
 *
 * Clamped at zero because that is what Stripe does — a discount larger than the
 * invoice zeroes it and the remainder is dropped rather than carried forward or
 * paid out. So "$200 off" against a $199 plan is not a $1 credit, it is a free
 * month, which is exactly the case this whole module exists to catch.
 *
 * Percent is rounded to the cent. Stripe does its own rounding on the real
 * invoice, so treat a percent result as within a cent rather than exact.
 */
export function applyDiscountCents(discount: PromoDiscount, unitAmountCents: number): number {
  const off =
    discount.kind === "percent"
      ? Math.round((unitAmountCents * discount.percentOff) / 100)
      : discount.amountOffCents;
  return Math.max(0, unitAmountCents - off);
}

/** Every plan priced with the discount applied, for the ops form's preview. */
export function previewDiscount(
  discount: PromoDiscount,
  plans: SeatPlanPrice[],
): PlanDiscountPreview[] {
  return plans.map((plan) => ({
    ...plan,
    afterCents: applyDiscountCents(discount, plan.unitAmountCents),
  }));
}

/**
 * Refuse a discount that bills any reachable plan $0.
 *
 * This is the whole guarantee, and it is deliberately stated as an outcome —
 * "what does this leave to pay" — rather than as separate rules for percent and
 * dollars. A cap like "dollars off must be under $199" is only correct until
 * someone changes a price; testing the computed total is correct whatever the
 * prices are, and catches 100% off in the same breath.
 *
 * Why $0 rather than negative: Stripe already clamps at zero, so a too-large
 * discount never shows up as a refund — it shows up as free service, silently.
 * A $200 code on the $199 monthly plan repeating for a year is twelve free
 * months, and nothing downstream would have flagged it.
 *
 * Checked against *every* seat price, not just the ones on the pricing page: a
 * coupon can also be put on a subscription by hand in the Stripe dashboard, so
 * the internal founding price is reachable too.
 */
export function assertDiscountLeavesSomethingToPay(
  discount: PromoDiscount,
  plans: SeatPlanPrice[],
): void {
  if (plans.length === 0) {
    // Fail closed. Without prices there is nothing to check the discount
    // against, and guessing a floor is how this bug happens again.
    throw new Error(
      "Could not read the plan prices from Stripe, so the discount can't be checked. Try again in a moment.",
    );
  }

  const free = previewDiscount(discount, plans).filter((p) => p.afterCents <= 0);
  if (free.length === 0) return;

  const names = free.map((p) => p.label).join(" and ");
  if (discount.kind === "percent") {
    throw new Error(
      `${discount.percentOff}% off leaves the ${names} plan at $0. Use less than 100%.`,
    );
  }

  // The largest discount that still leaves every plan something to pay is a
  // cent under the cheapest one. Naming that number is more use than naming the
  // rule, because it is the number whoever is on the form has to type.
  const cheapest = formatUsd(cheapestPlanCents(plans));
  throw new Error(
    `${formatUsd(discount.amountOffCents)} off is more than the ${names} plan (${cheapest}), ` +
      `so it would bill $0. Keep dollars off under ${cheapest} — or use a percentage, ` +
      `which scales with each plan instead.`,
  );
}

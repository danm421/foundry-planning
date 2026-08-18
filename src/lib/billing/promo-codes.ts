import type Stripe from "stripe";
import { getStripe } from "./stripe-client";
import { getPriceCatalog, type PriceCatalog } from "./price-catalog";
import {
  assertDiscountLeavesSomethingToPay,
  plansInProducts,
  type PromoDiscount,
  type PlanPrice,
} from "./promo-discount-math";

/**
 * Promo codes for the public checkout flow.
 *
 * Stripe is the single source of truth — there is no local mirror table, so the
 * ops list can never drift from what a buyer actually gets, and redemption
 * counting is Stripe's job rather than ours. A code Dan creates by hand in the
 * Stripe dashboard shows up in the ops list too.
 *
 * The two Stripe objects behind one "promo code":
 *   Coupon         — the discount itself (how much, for how long)
 *   PromotionCode  — the string a buyer types at checkout, pointing at a coupon
 *
 * Buyers reach this via `allow_promotion_codes: true` on the Checkout session,
 * which lives in the storefront repo (foundry-finance-storefront).
 */

// Foundry prices are USD-only (see docs/stripe-price-setup-checklist.md).
const CURRENCY = "usd";
const MAX_YEARS = 5;

export type CreatePromoInput = {
  /** Internal label; Stripe shows it on the buyer's invoice line. */
  name: string;
  discount: PromoDiscount;
  /** Whole years the discount stays on the subscription. */
  years: number;
  /** How many buyers can redeem this code, in total. */
  maxRedemptions: number;
  /** Customer-facing string. Blank → Stripe generates one. */
  code?: string | null;
  /** After this date the code stops working (redemption cutoff, not discount length). */
  expiresAt?: Date | null;
  /** Restrict to customers with no prior successful payment. */
  firstTimeOnly?: boolean;
  /**
   * Stripe Products the discount is allowed to touch — the only unit
   * `applies_to` accepts. Always written, so a code is fenced to what was
   * chosen instead of spreading across the whole invoice subtotal.
   */
  productIds: string[];
};

/**
 * Stripe accepts only `a-z A-Z 0-9 -` in a promotion code, and matches it
 * case-insensitively. Uppercase and drop everything else so what ops types
 * ("founder 25") becomes what the buyer types ("FOUNDER25").
 */
export function normalizePromoCode(input: string | null | undefined): string | null {
  if (!input) return null;
  const cleaned = input.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
  return cleaned || null;
}

function assertValid(input: CreatePromoInput): void {
  if (!input.name.trim()) {
    throw new Error("Give the promo code a name — it appears on the buyer's invoice.");
  }
  if (!Number.isInteger(input.years) || input.years < 1 || input.years > MAX_YEARS) {
    throw new Error(`Discount length must be a whole number of years between 1 and ${MAX_YEARS}.`);
  }
  if (!Number.isInteger(input.maxRedemptions) || input.maxRedemptions < 1) {
    throw new Error("The code has to be usable by at least 1 person.");
  }
  if (input.discount.kind === "percent") {
    const p = input.discount.percentOff;
    // 100% bills $0 whatever the prices are, so it is rejected here rather than
    // by the price check below: it needs no Stripe round trip to know, and the
    // operator still gets the real reason when Stripe is unreachable.
    if (!(p > 0 && p < 100)) {
      throw new Error("Percent off must be between 1 and 99.");
    }
  } else if (!(input.discount.amountOffCents > 0)) {
    throw new Error("Dollar amount off must be greater than $0.");
  }
}

/**
 * The discount half. One coupon has to serve both Foundry prices, and Stripe
 * measures a coupon only in months, so "N years" becomes N*12 months in effect.
 *
 * Monthly ($199/mo): the discount window opens at signup and the first invoice
 * lands when the 14-day trial ends, so one year covers the invoices at day 14
 * through month 11.5 — 12 of them — and month 12.5 renews at full price.
 *
 * Annual ($1,990/yr): the renewal invoice lands 14 days AFTER the window
 * closes, for the same reason — the trial pushes the whole billing cycle out.
 * That 14-day margin is what keeps year two at full price, so it does not
 * depend on how Stripe rounds a discount that ends exactly on a renewal.
 *
 * The margin is inherited from `trial_period_days: 14` in the storefront's
 * checkout params. Drop the trial to zero and the annual renewal lands exactly
 * on the boundary, where the rounding question becomes real again.
 */
export function buildCouponParams(input: CreatePromoInput): Stripe.CouponCreateParams {
  assertValid(input);
  const amount =
    input.discount.kind === "percent"
      ? { percent_off: input.discount.percentOff }
      : { amount_off: input.discount.amountOffCents, currency: CURRENCY };
  return {
    name: input.name.trim(),
    duration: "repeating",
    duration_in_months: input.years * 12,
    // Also capped on the promotion code below. Setting it here too means the
    // discount can't outrun its limit even if the coupon is ever applied by
    // hand in the Stripe dashboard.
    max_redemptions: input.maxRedemptions,
    // Fences the discount to the chosen products. Without this a coupon comes
    // off the whole invoice subtotal, so a seat discount would also come off any
    // add-on billed alongside it. Deduped because several plans can share a
    // product and Stripe rejects a repeated id.
    applies_to: { products: [...new Set(input.productIds)] },
    metadata: { source: "foundry_ops", years: String(input.years) },
    ...amount,
  };
}

/** The buyer-facing half: the string typed at checkout, plus its limits. */
export function buildPromotionCodeParams(
  couponId: string,
  input: CreatePromoInput,
): Stripe.PromotionCodeCreateParams {
  assertValid(input);
  const code = normalizePromoCode(input.code);
  return {
    promotion: { type: "coupon", coupon: couponId },
    ...(code ? { code } : {}),
    max_redemptions: input.maxRedemptions,
    ...(input.expiresAt ? { expires_at: Math.floor(input.expiresAt.getTime() / 1000) } : {}),
    ...(input.firstTimeOnly ? { restrictions: { first_time_transaction: true } } : {}),
    metadata: { source: "foundry_ops" },
  };
}

// ---------------------------------------------------------------------------
// Read model
// ---------------------------------------------------------------------------

export type PromoCodeStatus = "active" | "expired" | "used up" | "inactive";

export type PromoCodeRow = {
  id: string;
  code: string;
  name: string | null;
  discountLabel: string;
  durationLabel: string;
  maxRedemptions: number | null;
  timesRedeemed: number;
  status: PromoCodeStatus;
  firstTimeOnly: boolean;
  expiresAt: string | null;
};

function discountLabel(c: Stripe.Coupon): string {
  if (c.percent_off != null) return `${c.percent_off}% off`;
  if (c.amount_off != null) {
    return `${new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: (c.currency ?? CURRENCY).toUpperCase(),
    }).format(c.amount_off / 100)} off`;
  }
  return "—";
}

function durationLabel(c: Stripe.Coupon): string {
  if (c.duration === "forever") return "Forever";
  if (c.duration === "once") return "First invoice";
  const months = c.duration_in_months;
  if (!months) return "—";
  if (months % 12 !== 0) return `${months} month${months === 1 ? "" : "s"}`;
  const years = months / 12;
  return `${years} year${years === 1 ? "" : "s"}`;
}

/**
 * Order matters. Stripe documents that "a promotion code is only active if the
 * coupon is also valid", and a coupon stops being valid once it hits its
 * redemption cap or expiry — so a sold-out code arrives with `active: false`.
 * Checking `active` first would label every sold-out code "inactive", which
 * reads as "somebody switched this off" instead of "this worked". Test the
 * specific reasons first and let `inactive` mean only a deliberate shut-off.
 */
function deriveStatus(p: Stripe.PromotionCode): PromoCodeStatus {
  if (p.max_redemptions != null && p.times_redeemed >= p.max_redemptions) return "used up";
  if (p.expires_at != null && p.expires_at * 1000 <= Date.now()) return "expired";
  if (!p.active) return "inactive";
  return "active";
}

/**
 * Flatten a Stripe promotion code (coupon expanded) into a serializable row for
 * the ops table. An unexpanded coupon comes back as a bare id string — that
 * renders as "—" rather than throwing, so one odd row can't blank the page.
 */
export function toPromoCodeRow(p: Stripe.PromotionCode): PromoCodeRow {
  const coupon = p.promotion?.coupon;
  const expanded = coupon && typeof coupon === "object" ? coupon : null;
  return {
    id: p.id,
    code: p.code,
    name: expanded?.name ?? null,
    discountLabel: expanded ? discountLabel(expanded) : "—",
    durationLabel: expanded ? durationLabel(expanded) : "—",
    maxRedemptions: p.max_redemptions,
    timesRedeemed: p.times_redeemed,
    status: deriveStatus(p),
    firstTimeOnly: p.restrictions?.first_time_transaction ?? false,
    expiresAt: p.expires_at == null ? null : new Date(p.expires_at * 1000).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Stripe operations
// ---------------------------------------------------------------------------

/**
 * What each seat price is called on the ops form.
 *
 * `satisfies` is load-bearing, not decoration: without it a price added to the
 * catalog and forgotten here would compile clean and simply drop out of the
 * discount check, so the guard would quietly stop covering a plan. With it, the
 * omission is a typecheck failure. Coverage must not be decided by whether
 * someone remembered to write a label.
 */
const PLAN_LABELS = {
  seatMonthly: "Monthly",
  seatAnnual: "Annual",
  seatFoundingAnnual: "Founding annual",
} as const satisfies Record<keyof PriceCatalog, string>;

/**
 * Every price a discount could land on, priced from Stripe.
 *
 * Read live rather than hardcoded: this is what the "can't bill $0" check
 * measures against, and a floor copied into the code here would keep passing
 * quietly the day a price changes.
 */
export async function listPlanPrices(): Promise<PlanPrice[]> {
  const catalog = getPriceCatalog();
  const stripe = getStripe();
  const entries = Object.entries(PLAN_LABELS) as [keyof typeof PLAN_LABELS, string][];
  return Promise.all(
    entries.map(async ([key, label]) => {
      const price = await stripe.prices.retrieve(catalog[key]);
      if (price.unit_amount == null) {
        // Tiered or metered pricing has no single per-unit figure to compare a
        // flat discount against. Refuse rather than skip the plan — skipping
        // would let a discount through unchecked on exactly that plan.
        throw new Error(`The ${label} price has no flat amount, so a discount can't be checked against it.`);
      }
      if (typeof price.product !== "string") {
        // Unexpanded, `product` is the bare id — which is what targeting needs.
        // An object means the call started expanding it, or the product was
        // deleted. Coercing either would produce an id that matches no product,
        // and a coupon aimed at nothing silently discounts nothing.
        throw new Error(
          `The ${label} price did not come back with a plain product id, so it can't be targeted.`,
        );
      }
      return { key, label, unitAmountCents: price.unit_amount, productId: price.product };
    }),
  );
}

/**
 * Create the coupon, then the code that points at it.
 *
 * Three failure modes, handled differently. A bad form fails in
 * `buildCouponParams` before any Stripe call. A discount big enough to bill a
 * plan $0 fails next, after reading prices but still before any write. A
 * Stripe-side rejection of the final call — a duplicate code is the common one
 * — happens with the coupon already created, so we delete it on the way out;
 * otherwise retyping the code would litter the account with dangling coupons.
 */
export async function createPromoCode(
  input: CreatePromoInput,
): Promise<{ id: string; code: string }> {
  const couponParams = buildCouponParams(input);
  // The money guarantee, enforced server-side: the form caps the inputs too,
  // but this action is reachable without it. Checked against the plans the
  // coupon can actually reach — that is what lets "$200 off annual" through
  // while leaving monthly, which it cannot touch, out of the arithmetic.
  //
  // Three ways this can have nothing to measure, and they are told apart in
  // this order deliberately. Reading the prices comes FIRST so that a Stripe
  // outage reports itself, rather than the operator being told to tick a plan
  // on a form that is showing none because the read failed.
  const plans = await listPlanPrices();
  if (input.productIds.length === 0) {
    throw new Error("Pick at least one plan for this code to apply to.");
  }
  const inScope = plansInProducts(plans, input.productIds);
  if (inScope.length === 0) {
    // Prices read fine and something was ticked, so the selection names products
    // the catalog no longer has — the form is showing a stale list.
    throw new Error(
      "None of the selected plans are in the current price list. Reload the page and choose again.",
    );
  }
  assertDiscountLeavesSomethingToPay(input.discount, inScope);
  const stripe = getStripe();
  const coupon = await stripe.coupons.create(couponParams);
  try {
    const promo = await stripe.promotionCodes.create(buildPromotionCodeParams(coupon.id, input));
    return { id: promo.id, code: promo.code };
  } catch (err) {
    // Best-effort cleanup: the original error is what the operator needs to
    // see, so a failed delete must not replace it.
    await stripe.coupons.del(coupon.id).catch(() => {});
    throw err;
  }
}

/** Stripe's per-page maximum. */
const LIST_LIMIT = 100;

/**
 * The coupon holds the discount and the duration, so we ask Stripe to inline it
 * rather than issuing one request per code. This is the only Stripe detail in
 * this file that isn't pinned down by the SDK's own types, so the call below
 * retries without it instead of letting a rejected expand blank the page —
 * rows then show "—" for discount and length, which is degraded but readable.
 */
const COUPON_EXPAND = "data.promotion.coupon";

/**
 * Promo codes in the Stripe account, newest first (Stripe's list order).
 *
 * Returns one page. `truncated` is the point of the wrapper: a silently capped
 * list looks identical to a complete one, and an operator who can't find a code
 * they made will make a second one — which Stripe then rejects as a duplicate.
 */
export async function listPromoCodes(): Promise<{
  rows: PromoCodeRow[];
  truncated: boolean;
}> {
  const stripe = getStripe();
  let res;
  try {
    res = await stripe.promotionCodes.list({ limit: LIST_LIMIT, expand: [COUPON_EXPAND] });
  } catch {
    // Retry bare. A real auth/network failure fails again here, and that second
    // error is the one that propagates — the operator still sees the true cause.
    res = await stripe.promotionCodes.list({ limit: LIST_LIMIT });
  }
  return { rows: res.data.map(toPromoCodeRow), truncated: res.has_more === true };
}

/**
 * Stop a code being redeemed. Stripe has no delete for promotion codes, and
 * deactivating is the right shape anyway — buyers who already redeemed keep
 * their discount.
 */
export async function deactivatePromoCode(id: string): Promise<void> {
  if (!id) throw new Error("Missing promo code id.");
  const stripe = getStripe();
  await stripe.promotionCodes.update(id, { active: false });
}

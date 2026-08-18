/**
 * Typed catalog of the three Stripe price IDs locked in the pricing spec.
 * Loaded from env on first call; cached for the process. Throws fast if any
 * env var is missing — the missing one is named in the error so deploys fail
 * loudly instead of silently misrouting Checkout sessions.
 *
 * The founding-annual price is intentionally exposed alongside the public
 * prices: the sales path needs the same typed handle, just gated by an
 * internal-only Checkout flow (see docs/founding-pricing-runbook.md).
 */
export type PriceCatalog = {
  seatMonthly: string;
  seatAnnual: string;
  seatFoundingAnnual: string;
};

export type PriceKind = "seat";

let cached: PriceCatalog | null = null;

// AI import is deliberately absent: it ships with every seat as a base
// entitlement (`BASE_ENTITLEMENTS`), and docs/bundle-ai-into-plan-runbook.md
// archives the standalone price. Adding it here would re-require a var that
// runbook deletes, and would drop the promo guard's floor to $98.99 to protect
// a price nothing can ever bill.
const ENV_TO_KEY = {
  STRIPE_PRICE_ID_SEAT_MONTHLY: "seatMonthly",
  STRIPE_PRICE_ID_SEAT_ANNUAL: "seatAnnual",
  STRIPE_PRICE_ID_SEAT_FOUNDING_ANNUAL: "seatFoundingAnnual",
} as const satisfies Record<string, keyof PriceCatalog>;

export function getPriceCatalog(): PriceCatalog {
  if (cached) return cached;
  const out = {} as PriceCatalog;
  for (const [envKey, prop] of Object.entries(ENV_TO_KEY) as [
    keyof typeof ENV_TO_KEY,
    keyof PriceCatalog,
  ][]) {
    const v = process.env[envKey];
    if (!v) {
      throw new Error(`${envKey} env var is required`);
    }
    out[prop] = v;
  }
  cached = out;
  return cached;
}

/**
 * Classify a Stripe price ID against the catalog. Returns `null` for unknown
 * IDs — callers (Checkout, webhook validation) decide whether unknown is a
 * hard error or a "ignore" depending on context.
 */
export function priceKindFor(priceId: string): PriceKind | null {
  const c = getPriceCatalog();
  if (priceId === c.seatMonthly) return "seat";
  if (priceId === c.seatAnnual) return "seat";
  if (priceId === c.seatFoundingAnnual) return "seat";
  return null;
}

export function __resetPriceCatalogForTests(): void {
  cached = null;
}

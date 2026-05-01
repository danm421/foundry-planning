import Stripe from "stripe";

let cached: Stripe | null = null;

/**
 * Singleton Stripe client. The only module that should import the `stripe`
 * package — everything else consumes this surface so the SDK can be mocked
 * in tests via vi.mock("@/lib/billing/stripe-client", ...).
 *
 * apiVersion is intentionally NOT pinned here — the SDK's default tracks the
 * version it was tested against, and pinning to a stale version (the plan
 * suggested an older codename) defeats the upgrade discipline. To pin in the
 * future, bump deliberately and re-run integration tests.
 */
export function getStripe(): Stripe {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY env var is required");
  }
  cached = new Stripe(key, {
    typescript: true,
  });
  return cached;
}

export function __resetStripeForTests(): void {
  cached = null;
}

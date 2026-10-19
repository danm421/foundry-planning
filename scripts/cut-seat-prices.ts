// scripts/cut-seat-prices.ts
//
// The 2026-10 price cut: $199/mo → $99/mo and $1,990/yr → $999/yr.
//
// Adds the new price to each seat plan's EXISTING product — Stripe's own shape
// for a price change. The product is what a coupon's `applies_to` aims at, so
// every promo code keeps reaching the plan it was made for, and the receipt
// name does not change. Firms already subscribed keep billing on their old
// price object, which is the decision: nobody is moved.
//
// Reports by default; creates nothing until you pass --apply:
//
//   npx tsx scripts/cut-seat-prices.ts                  # dry run
//   npx tsx scripts/cut-seat-prices.ts --apply          # test mode
//   npx tsx scripts/cut-seat-prices.ts --apply --live   # live mode
//
// Reads the CURRENT catalog from env, so run it before repointing env. Safe to
// re-run: a matching active price under the product is reused, never doubled.
// It never edits env and never archives — it prints both, ids filled in,
// because archiving before the new ids are deployed would break checkout.
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env", override: false });

import Stripe from "stripe";
import { getPriceCatalog } from "../src/lib/billing/price-catalog";
import { applyDiscountCents, formatUsd } from "../src/lib/billing/promo-discount-math";

const TAG = "[cut-seat-prices]";

const NEW_PRICES = {
  seatMonthly: { cents: 9_900, env: "STRIPE_PRICE_ID_SEAT_MONTHLY", nickname: "seat_monthly" },
  seatAnnual: { cents: 99_900, env: "STRIPE_PRICE_ID_SEAT_ANNUAL", nickname: "seat_annual" },
} as const;

type PlanKey = keyof typeof NEW_PRICES;

function fail(message: string): never {
  console.error(`${TAG} ${message}`);
  process.exit(1);
}

/** The key's own prefix decides the mode; a live key also needs --live. */
function resolveMode(wantsLive: boolean): "test" | "live" {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) fail("STRIPE_SECRET_KEY is not set. Add it to .env.local.");
  const live = key.startsWith("sk_live_") || key.startsWith("rk_live_");
  if (live && !wantsLive) fail("STRIPE_SECRET_KEY is a LIVE key. Re-run with --live if that is deliberate.");
  if (!live && wantsLive) fail("--live was passed but STRIPE_SECRET_KEY is a TEST key. Nothing done.");
  return live ? "live" : "test";
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const mode = resolveMode(argv.includes("--live"));
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { typescript: true });
  const catalog = getPriceCatalog();

  console.log(`${TAG} mode=${mode} ${apply ? "APPLY" : "dry run — nothing will be created"}`);

  const results: { key: PlanKey; oldPriceId: string; newPriceId: string }[] = [];

  for (const key of Object.keys(NEW_PRICES) as PlanKey[]) {
    const want = NEW_PRICES[key];
    const old = await stripe.prices.retrieve(catalog[key]);
    if (typeof old.product !== "string" || !old.recurring || old.unit_amount == null) {
      fail(`${key} (${old.id}) is not a flat recurring price under a live product.`);
    }
    if (old.unit_amount === want.cents) {
      fail(`${key} env already points at a ${formatUsd(want.cents)} price (${old.id}). Already cut?`);
    }
    console.log(
      `${TAG} ${key}: ${formatUsd(old.unit_amount)}/${old.recurring.interval} (${old.id}) → ` +
        `${formatUsd(want.cents)}/${old.recurring.interval} under ${old.product}`,
    );

    let existing: Stripe.Price | null = null;
    for await (const p of stripe.prices.list({ product: old.product, active: true, limit: 100 })) {
      if (p.unit_amount === want.cents && p.recurring?.interval === old.recurring.interval) {
        existing = p;
        break;
      }
    }
    if (existing) {
      console.log(`${TAG}   reusing ${existing.id}`);
      results.push({ key, oldPriceId: old.id, newPriceId: existing.id });
      continue;
    }
    if (!apply) continue;

    // Cloned from the old price for everything but the amount, so currency,
    // interval and tax behavior cannot drift.
    const created = await stripe.prices.create({
      product: old.product,
      unit_amount: want.cents,
      currency: old.currency,
      recurring: { interval: old.recurring.interval },
      ...(old.tax_behavior ? { tax_behavior: old.tax_behavior } : {}),
      nickname: want.nickname,
      metadata: { kind: "seat", foundry_plan: key },
    });
    await stripe.products.update(old.product, { default_price: created.id });
    console.log(`${TAG}   created ${created.id} and made it the product's default`);
    results.push({ key, oldPriceId: old.id, newPriceId: created.id });
  }

  // Stripe never echoes a coupon's `applies_to`, so which plan a code reaches
  // cannot be read back. Flag every live dollar-off code that could zero the
  // cheaper new plan and let a human check its targeting.
  const floor = Math.min(...Object.values(NEW_PRICES).map((p) => p.cents));
  const risky: string[] = [];
  for await (const code of stripe.promotionCodes.list({
    active: true,
    limit: 100,
    expand: ["data.promotion.coupon"],
  })) {
    const coupon = code.promotion?.coupon;
    if (!coupon || typeof coupon !== "object" || coupon.amount_off == null) continue;
    if (applyDiscountCents({ kind: "amount", amountOffCents: coupon.amount_off }, floor) <= 0) {
      risky.push(`${code.code} (${formatUsd(coupon.amount_off)} off)`);
    }
  }
  console.log(
    risky.length === 0
      ? `${TAG} no active dollar-off promo code can zero a ${formatUsd(floor)} plan.`
      : `${TAG} ⚠️  these active codes could bill a ${formatUsd(floor)} plan $0 — check their ` +
          `plans in /admin/promo-codes and deactivate any aimed at monthly:\n${TAG}   ${risky.join("\n" + TAG + "   ")}`,
  );

  if (!apply) {
    console.log(`${TAG} dry run only. Re-run with --apply to create the prices above.`);
    process.exit(0);
  }

  console.log(`\n${TAG} ── 1. Set these (${mode} mode). Both repos take the first two; ──`);
  console.log(`${TAG} ──    the _LEGACY pair is foundry-planning only.                   ──`);
  for (const r of results) console.log(`${NEW_PRICES[r.key].env}=${r.newPriceId}`);
  for (const r of results) console.log(`${NEW_PRICES[r.key].env}_LEGACY=${r.oldPriceId}`);

  console.log(`\n${TAG} ── 2. AFTER both repos deploy with those ids, archive the old prices ──`);
  console.log(`${TAG} Firms on them keep billing; archiving only stops new sign-ups landing there.`);
  for (const r of results) console.log(`${TAG}   archive ${r.oldPriceId}  (old ${r.key})`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`${TAG} failed:`, err instanceof Error ? err.message : err);
  process.exit(1);
});

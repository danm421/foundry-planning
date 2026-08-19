// scripts/setup-stripe-plan-products.ts
//
// Give every seat price its own Stripe Product, so a promo code can be aimed at
// one plan. A coupon's `applies_to` accepts PRODUCT ids only — never prices,
// never intervals — so two prices sharing a product can never be discounted
// apart. That is what billed the $199/mo plan $0 for twelve months when a
// "$200 off annual" code was created against the shared product.
// See docs/stripe-price-setup-checklist.md for the whole picture.
//
// Reports by default; creates nothing until you pass --apply:
//
//   npx tsx scripts/setup-stripe-plan-products.ts            # dry run
//   npx tsx scripts/setup-stripe-plan-products.ts --apply    # create them
//   npx tsx scripts/setup-stripe-plan-products.ts --apply --live
//
// The mode comes from STRIPE_SECRET_KEY's own prefix, not a flag. A live key
// needs --live as well, so a stray copy-paste of live credentials into
// .env.local cannot quietly create real products.
//
// Safe to re-run: an already-split plan is left alone, and a product this
// script created before is matched by its `foundry_plan` metadata rather than
// created twice.
//
// It never archives and never edits env — both are follow-ups it prints with
// the real ids filled in, because both are visible to existing subscribers.
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env", override: false });

import Stripe from "stripe";
import { getPriceCatalog, type PriceCatalog } from "../src/lib/billing/price-catalog";

const TAG = "[setup-stripe-plan-products]";

/**
 * The name on the buyer's receipt, per plan. One line per catalog key, so a new
 * plan is a typecheck failure here rather than a product that silently keeps
 * whatever name Stripe defaults to.
 */
const PLAN_PRODUCT_NAMES = {
  seatMonthly: "Foundry seat — billed monthly",
  seatAnnual: "Foundry seat — billed annually",
  seatFoundingAnnual: "Foundry seat — founding rate, billed annually",
} as const satisfies Record<keyof PriceCatalog, string>;

/** Price nicknames from the pricing spec — internal, not buyer-visible. */
const PLAN_NICKNAMES = {
  seatMonthly: "seat_monthly",
  seatAnnual: "seat_annual",
  seatFoundingAnnual: "seat_founding_annual",
} as const satisfies Record<keyof PriceCatalog, string>;

/**
 * The plan that KEEPS the shared product when one is split. Monthly, because
 * the original "Foundry seat" product is the one every legacy subscription
 * bills against — repointing the fewest live prices is the safest split.
 */
const KEEPS_SHARED_PRODUCT: keyof PriceCatalog = "seatMonthly";

type PlanKey = keyof PriceCatalog;

type CurrentPrice = {
  key: PlanKey;
  priceId: string;
  productId: string;
  unitAmountCents: number;
  currency: string;
  interval: Stripe.Price.Recurring.Interval;
};

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function fail(message: string): never {
  console.error(`${TAG} ${message}`);
  process.exit(1);
}

/**
 * Refuse a live key unless it was asked for by name. Reads the mode off the key
 * itself: a flag saying "test" while the key says live would create real
 * products, so the key is the only thing worth trusting here.
 */
function resolveMode(wantsLive: boolean): "test" | "live" {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) fail("STRIPE_SECRET_KEY is not set. Add it to .env.local.");
  if (key.startsWith("sk_live_") || key.startsWith("rk_live_")) {
    if (!wantsLive) {
      fail(
        "STRIPE_SECRET_KEY is a LIVE key. Re-run with --live if that is deliberate, " +
          "or point .env.local at a test key.",
      );
    }
    return "live";
  }
  if (!key.startsWith("sk_test_") && !key.startsWith("rk_test_")) {
    fail(`STRIPE_SECRET_KEY does not look like a Stripe secret key (starts "${key.slice(0, 8)}").`);
  }
  if (wantsLive) fail("--live was passed but STRIPE_SECRET_KEY is a TEST key. Nothing done.");
  return "test";
}

/** Read each catalog price as Stripe currently holds it. */
async function readCurrentPrices(stripe: Stripe, catalog: PriceCatalog): Promise<CurrentPrice[]> {
  const keys = Object.keys(PLAN_PRODUCT_NAMES) as PlanKey[];
  return Promise.all(
    keys.map(async (key) => {
      const price = await stripe.prices.retrieve(catalog[key]);
      if (typeof price.product !== "string") {
        // Unexpanded, `product` is the bare id. An object means a deleted
        // product, and cloning from it would build a price under nothing.
        fail(`${key} (${catalog[key]}) has no plain product id — is the product deleted?`);
      }
      if (price.unit_amount == null) {
        fail(`${key} (${catalog[key]}) has no flat amount, so it cannot be cloned.`);
      }
      if (!price.recurring) {
        fail(`${key} (${catalog[key]}) is not a recurring price. The seat plans all recur.`);
      }
      return {
        key,
        priceId: price.id,
        productId: price.product,
        unitAmountCents: price.unit_amount,
        currency: price.currency,
        interval: price.recurring.interval,
      };
    }),
  );
}

/**
 * A product this script already made for `key`, or null.
 *
 * Scans the product list rather than the Search API: search is eventually
 * consistent, so two runs in quick succession could both see "nothing there"
 * and each create a product. Listing is immediately consistent.
 */
async function findExistingProduct(stripe: Stripe, key: PlanKey): Promise<Stripe.Product | null> {
  let found: Stripe.Product | null = null;
  for await (const product of stripe.products.list({ limit: 100, active: true })) {
    if (product.metadata?.foundry_plan === key) {
      found = product;
      break;
    }
  }
  return found;
}

/** An active price under `productId` that already matches this plan, or null. */
async function findExistingPrice(
  stripe: Stripe,
  productId: string,
  want: CurrentPrice,
): Promise<Stripe.Price | null> {
  for await (const price of stripe.prices.list({ product: productId, active: true, limit: 100 })) {
    if (
      price.unit_amount === want.unitAmountCents &&
      price.currency === want.currency &&
      price.recurring?.interval === want.interval
    ) {
      return price;
    }
  }
  return null;
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const mode = resolveMode(argv.includes("--live"));

  const catalog = getPriceCatalog();
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { typescript: true });

  console.log(`${TAG} mode=${mode} ${apply ? "APPLY" : "dry run — nothing will be created"}`);

  const current = await readCurrentPrices(stripe, catalog);
  const byKey = new Map(current.map((p) => [p.key, p]));

  console.log(`${TAG} current shape:`);
  for (const p of current) {
    console.log(
      `${TAG}   ${p.key.padEnd(18)} ${p.priceId}  ${usd(p.unitAmountCents)}/${p.interval}  under ${p.productId}`,
    );
  }

  // A plan needs its own product when it shares one with any other plan. The
  // designated keeper stays put; everything else moves.
  const sharedWith = new Map<string, PlanKey[]>();
  for (const p of current) {
    sharedWith.set(p.productId, [...(sharedWith.get(p.productId) ?? []), p.key]);
  }
  const needsSplit = current.filter(
    (p) => (sharedWith.get(p.productId)?.length ?? 1) > 1 && p.key !== KEEPS_SHARED_PRODUCT,
  );

  if (needsSplit.length === 0) {
    console.log(`${TAG} every plan already has its own product. Nothing to do.`);
    // Still worth saying out loud: one product per price is the invariant the
    // promo form depends on, and it now holds.
    process.exit(0);
  }

  console.log(
    `${TAG} ${needsSplit.length} plan(s) need their own product: ${needsSplit.map((p) => p.key).join(", ")}`,
  );

  const results: { key: PlanKey; productId: string; priceId: string; oldPriceId: string }[] = [];

  for (const plan of needsSplit) {
    if (!apply) {
      console.log(
        `${TAG}   would create product "${PLAN_PRODUCT_NAMES[plan.key]}" ` +
          `+ a ${usd(plan.unitAmountCents)}/${plan.interval} price cloned from ${plan.priceId}`,
      );
      continue;
    }

    let product = await findExistingProduct(stripe, plan.key);
    if (product) {
      console.log(`${TAG}   reusing product ${product.id} for ${plan.key} (already created)`);
    } else {
      product = await stripe.products.create({
        name: PLAN_PRODUCT_NAMES[plan.key],
        metadata: {
          kind: "seat",
          // What makes a re-run idempotent. Do not rename this key.
          foundry_plan: plan.key,
          ...(plan.key === "seatFoundingAnnual" ? { founding: "true" } : {}),
        },
      });
      console.log(`${TAG}   created product ${product.id} "${PLAN_PRODUCT_NAMES[plan.key]}"`);
    }

    let price = await findExistingPrice(stripe, product.id, plan);
    if (price) {
      console.log(`${TAG}   reusing price ${price.id} under ${product.id}`);
    } else {
      // Cloned from the live price rather than typed from the spec, so the new
      // price cannot drift from what buyers are actually charged today.
      price = await stripe.prices.create({
        product: product.id,
        unit_amount: plan.unitAmountCents,
        currency: plan.currency,
        recurring: { interval: plan.interval },
        nickname: PLAN_NICKNAMES[plan.key],
        metadata: { kind: "seat", foundry_plan: plan.key },
      });
      console.log(
        `${TAG}   created price ${price.id} ${usd(plan.unitAmountCents)}/${plan.interval}`,
      );
    }

    results.push({ key: plan.key, productId: product.id, priceId: price.id, oldPriceId: plan.priceId });
  }

  if (!apply) {
    console.log(`${TAG} dry run only. Re-run with --apply to create the above.`);
    process.exit(0);
  }

  const ENV_FOR: Record<PlanKey, string> = {
    seatMonthly: "STRIPE_PRICE_ID_SEAT_MONTHLY",
    seatAnnual: "STRIPE_PRICE_ID_SEAT_ANNUAL",
    seatFoundingAnnual: "STRIPE_PRICE_ID_SEAT_FOUNDING_ANNUAL",
  };

  console.log(`\n${TAG} ── 1. Repoint these, in BOTH repos (${mode} mode) ──`);
  for (const r of results) {
    console.log(`${ENV_FOR[r.key]}=${r.priceId}`);
  }

  console.log(`\n${TAG} ── 2. THEN archive the old prices ──`);
  console.log(
    `${TAG} They stay under the monthly product, so until they are archived a later\n` +
      `${TAG} "monthly only" coupon would silently discount every legacy annual\n` +
      `${TAG} subscriber. Stripe cannot move a price between products. Existing\n` +
      `${TAG} subscriptions keep billing on the price they were created with, so\n` +
      `${TAG} archiving changes nobody's rate.`,
  );
  for (const r of results) {
    console.log(`${TAG}   archive ${r.oldPriceId}  (old ${r.key})`);
  }

  const monthly = byKey.get(KEEPS_SHARED_PRODUCT);
  console.log(`\n${TAG} ── 3. Rename the kept product ──`);
  console.log(
    `${TAG}   ${monthly?.productId} → "${PLAN_PRODUCT_NAMES[KEEPS_SHARED_PRODUCT]}"` +
      ` (it is buyer-visible on receipts)`,
  );

  process.exit(0);
}

main().catch((err) => {
  console.error(`${TAG} failed:`, err instanceof Error ? err.message : err);
  process.exit(1);
});

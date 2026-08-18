# Stripe Price Setup — Manual Checklist

The pricing spec locks three seat prices. This checklist captures them so a future
us (or an auditor) can replay the dashboard config from scratch.

Run this in **test mode first**, copy the price IDs into Vercel envs, and
verify webhook + checkout flow before flipping to **live mode**. The same
three prices need to exist in both modes.

## Products + prices

**One Product per price. This is load-bearing, not tidiness.**

A promo coupon's `applies_to` accepts **product IDs only** — never prices, never
intervals. So two prices sharing a product can never be discounted apart. When
all three seat prices lived under a single "Foundry seat" product, a "$200 off"
code meant for the annual plan also applied to the $199/mo plan and billed it
**$0 for twelve months**. Splitting them is what makes an interval targetable.

The product name is what the buyer sees on their receipt, so each one names the
plan it bills.

| Product (on the receipt) | Amount | Interval | Nickname | Public? | Metadata |
|---|---|---|---|---|---|
| `Foundry seat — billed monthly` | $199.00 USD | month | `seat_monthly` | yes | kind=seat |
| `Foundry seat — billed annually` | $1,990.00 USD | year | `seat_annual` | yes | kind=seat |
| `Foundry seat — founding rate, billed annually` | $1,788.00 USD | year | `seat_founding_annual` | **internal only** | kind=seat, founding=true |

AI import is **not** on this list any more: it ships with every seat as a base
entitlement, and `docs/bundle-ai-into-plan-runbook.md` archives the standalone
product and price. Nothing bills it, so it is deliberately outside the price
catalog and outside the promo guard — putting it back would drop the ceiling on
every all-plans dollar discount to $98.99 to protect a price no one can buy.

⚠️ **Do not add a second price to any of these products.** The ops promo form
groups its plan checkboxes by product and will take every plan under a ticked
one — correctly, since Stripe cannot split them, but the operator loses the
ability to aim at one of the pair.

## Env-var mapping

After creating each price, copy its ID (`price_…`) and set in Vercel:

```
STRIPE_PRICE_ID_SEAT_MONTHLY              ← seat_monthly
STRIPE_PRICE_ID_SEAT_ANNUAL               ← seat_annual
STRIPE_PRICE_ID_SEAT_FOUNDING_ANNUAL      ← seat_founding_annual
```

Set in **all three Vercel environments** (Development, Preview, Production)
with separate values for test-mode (Dev/Preview) vs live-mode (Production), and
in **both repos** — `foundry-planning` reads all three, the storefront reads the
two public seat prices.


## Migrating an existing account off the single-product shape

Annual and founding-annual originally sat under the monthly product. To split
them without disturbing anyone already paying:

1. Create the new products + prices above:

   ```bash
   npx tsx scripts/setup-stripe-plan-products.ts            # shows the plan
   npx tsx scripts/setup-stripe-plan-products.ts --apply    # creates it
   ```

   It clones each new price from the live one rather than re-typing the amount,
   so the split cannot change what anyone is charged. It reports without
   creating anything until `--apply`, refuses a live key unless `--live` is also
   passed, and is safe to re-run — it reuses a product it already made instead
   of creating a second one. It prints steps 2–4 below with the real IDs filled
   in.
2. Repoint `STRIPE_PRICE_ID_SEAT_ANNUAL` and `_FOUNDING_ANNUAL` at the new
   prices, test mode first.
3. **Archive the old annual and founding-annual prices.** ⚠️ Skipping this is a
   live hazard, not housekeeping: the old prices stay under the *monthly*
   product, so a later "monthly only" coupon would silently discount every
   legacy annual subscriber too. Stripe cannot move a price between products, so
   archiving is the only thing that stops new use of them.
4. Rename the monthly product to `Foundry seat — billed monthly`.

Existing subscriptions keep billing on the price object they were created with,
which is intended — nobody's rate changes.

## Verification

After setting envs, deploy + run:
```bash
vercel env pull .env.local
node -e "require('./src/lib/billing/price-catalog').getPriceCatalog()"
```
Should print all three IDs without throwing.

## Stripe Tax

Enable Stripe Tax under Settings → Tax. Activate for the U.S.
states/jurisdictions Foundry sells into (open question in pricing spec —
resolve before public launch).

## Founding price visibility

The founding-annual price should NOT be linked from `/pricing`. Tag it
internal-only via metadata `founding=true` so the pricing-page renderer can
filter it out programmatically (Phase 4 work).

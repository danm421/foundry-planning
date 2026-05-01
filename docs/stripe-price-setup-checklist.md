# Stripe Price Setup — Manual Checklist

The pricing spec locks four prices. This checklist captures them so a future
us (or an auditor) can replay the dashboard config from scratch.

Run this in **test mode first**, copy the price IDs into Vercel envs, and
verify webhook + checkout flow before flipping to **live mode**. The same
four prices need to exist in both modes.

## Products + prices

Create one Product per kind. Under each product, create the listed Price
objects.

### Product: "Foundry seat"

| Price | Amount | Interval | Nickname | Public? | Metadata |
|---|---|---|---|---|---|
| Monthly | $199.00 USD | month | `seat_monthly` | yes | kind=seat |
| Annual | $1,990.00 USD | year | `seat_annual` | yes | kind=seat |
| Founding annual | $1,788.00 USD | year | `seat_founding_annual` | **internal only** | kind=seat, founding=true |

### Product: "AI Import"

| Price | Amount | Interval | Nickname | Public? | Metadata |
|---|---|---|---|---|---|
| Monthly | $99.00 USD | month | `ai_import_monthly` | yes | kind=addon, addon_key=ai_import |

## Env-var mapping

After creating each price, copy its ID (`price_…`) and set in Vercel:

```
STRIPE_PRICE_ID_SEAT_MONTHLY              ← seat_monthly
STRIPE_PRICE_ID_SEAT_ANNUAL               ← seat_annual
STRIPE_PRICE_ID_SEAT_FOUNDING_ANNUAL      ← seat_founding_annual
STRIPE_PRICE_ID_AI_IMPORT_MONTHLY         ← ai_import_monthly
```

Set in **all three Vercel environments** (Development, Preview, Production)
with separate values for test-mode (Dev/Preview) vs live-mode (Production).

## Verification

After setting envs, deploy + run:
```bash
vercel env pull .env.local
node -e "require('./src/lib/billing/price-catalog').getPriceCatalog()"
```
Should print all four IDs without throwing.

## Stripe Tax

Enable Stripe Tax under Settings → Tax. Activate for the U.S.
states/jurisdictions Foundry sells into (open question in pricing spec —
resolve before public launch).

## Founding price visibility

The founding-annual price should NOT be linked from `/pricing`. Tag it
internal-only via metadata `founding=true` so the pricing-page renderer can
filter it out programmatically (Phase 4 work).

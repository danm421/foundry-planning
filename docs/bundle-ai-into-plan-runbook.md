# Runbook: Bundle AI import into the base plan

AI document import is now included with every seat. The standalone AI-import
add-on no longer exists in code. Complete these one-time platform steps after
deploy:

## Stripe Dashboard
- [ ] Archive the **AI Import (monthly)** price so it can't be added to new or
      existing subscriptions.
- [ ] Archive the parent **AI Import** product.
- [ ] Confirm no live subscription carries the AI-import line item
      (Subscriptions → filter by price). None expected — there were no paying
      add-on customers.

## Environment variables (Vercel + local)
- [ ] Remove `STRIPE_PRICE_ID_AI_IMPORT_MONTHLY` from all Vercel environments
      (Production, Preview, Development).
- [ ] Remove `STRIPE_PRICE_ID_AI_IMPORT_MONTHLY` from local `.env.local`.
  - The app no longer requires this var at boot (`getPriceCatalog` only
    validates the three seat price IDs), so a stale value is harmless but
    should be cleaned up.

## Verification
- [ ] On a seat subscription (incl. the founder trial firm), confirm Clerk org
      `publicMetadata.entitlements` includes `ai_import` after the next
      `customer.subscription.updated` webhook or reconcile-billing cron pass.
- [ ] Run an AI import end-to-end on that firm and confirm extraction succeeds
      (no 403 `ai_import_not_entitled`).

## Storefront (separate repo)
- [ ] Remove any "AI import" add-on toggle / upsell from the storefront pricing
      + checkout pages — those call `buildCheckoutSessionParams`, which no
      longer accepts `withAiImport`.

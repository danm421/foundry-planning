# Founding Customer Pricing — Sales Runbook

**Audience:** Internal only. Do not link from the public site.

## What it is

$1,788/year per advisor, **annual only**, **price-locked for life of the
subscription**. ~25 firms total. Trade: logo + testimonial.

## Eligibility

- Founder-cohort slot count is < 25 (track in `docs/founding-customers.md`,
  one row per closed firm).
- Firm has not previously held a Foundry subscription.
- Annual-only — no monthly path; do not offer a monthly downgrade.

## Pitch

> "Foundry runs $199/mo per seat publicly. We're offering the first 25 firms
> $149/mo equivalent ($1,788/yr per seat), locked for the life of your
> subscription. The trade is a logo + a written testimonial we can quote.
> Annual-only, charged up-front."

## How to issue

Two paths — pick whichever fits the lead:

### 1. Hand-built Checkout session (preferred — buyer self-serves payment)

```bash
# Pick the founding price ID from the Stripe dashboard. It corresponds to
# env var STRIPE_PRICE_ID_SEAT_FOUNDING_ANNUAL in Vercel envs (production).

stripe checkout sessions create \
  --mode=subscription \
  --line-items[0][price]=$STRIPE_PRICE_ID_SEAT_FOUNDING_ANNUAL \
  --line-items[0][quantity]=1 \
  --customer-email=$BUYER_EMAIL \
  --consent-collection[terms_of_service]=required \
  --custom-fields[0][key]=firm_name \
  --custom-fields[0][label][type]=custom \
  --custom-fields[0][label][custom]="Firm Name" \
  --custom-fields[0][type]=text \
  --metadata[founding]=true \
  --metadata[cohort_slot]=$NEXT_SLOT_NUMBER
```
Send the resulting URL to the buyer.

### 2. Stripe-dashboard-created subscription (fallback — for hands-on onboarding)

1. Stripe dashboard → Customers → New customer (with their email + firm name).
2. Subscriptions → Create subscription → attach the founding-annual price,
   quantity 1.
3. Set subscription metadata: `firm_id` = (you'll fill this after step 4)
   and `founding=true`.
4. After buyer pays + Clerk webhook auto-creates the org, copy the new
   firm_id back into the Stripe subscription metadata.
5. Trigger `customer.subscription.updated` from the dashboard (or wait for
   the next webhook) to push `entitlements` through.

## Aftercare

- Add the firm to `docs/founding-customers.md` with: closed date, slot
  number, contact, testimonial-due date.
- Set a 60-day reminder to collect the written testimonial.
- Do NOT add their seat count to the public ARR pipeline — track founding
  ARR separately.

## Sunset

When slot 20 is sold, decide: sunset the program at 25, extend, or roll
into "early access." Default = sunset; let public price stand.

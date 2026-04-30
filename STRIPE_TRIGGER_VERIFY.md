# Stripe trigger verification — billing Phase 3

Manual verification gate for `feature/billing-phase-3` before merge.
Runs each Stripe event end-to-end against a local dev server and confirms
the webhook handler chain (signature verify → idempotency insert → handler
dispatch → DB write → Clerk metadata sync → audit row) executes cleanly.

This file is **not yet filled in** — fill in the date, mark each event
verified, and re-commit once the run is complete.

## Setup

```bash
# Terminal 1
stripe listen --forward-to localhost:3000/api/webhooks/stripe --print-secret
# Copy the whsec_... value into .env.local (replace any placeholder).

# Terminal 2
npm run dev
# Wait for "Ready on http://localhost:3000".

# Terminal 3 — fire each event below.
```

## Events

For each event below, verify:

- HTTP 200 in Terminal 1 (`stripe listen` confirms forwarding succeeded).
- A `billing_events` row was written with `result='ok'` (Neon MCP
  `run_sql` against the `dev` branch — `br-curly-cell-amew7wcr`).
- Expected DB side-effect (subscription, invoice, or audit_log row).
- No 500s in dev server log.

| Event | Date verified | Notes |
|---|---|---|
| `checkout.session.completed` | _pending_ | run with `--add 'consent_collection[terms_of_service]=accepted' --add 'custom_fields[0][key]=firm_name' --add 'custom_fields[0][text][value]=Test Firm'` |
| `customer.subscription.created` | _pending_ | |
| `customer.subscription.updated` | _pending_ | |
| `customer.subscription.deleted` | _pending_ | |
| `customer.subscription.paused` | _pending_ | |
| `customer.subscription.trial_will_end` | _pending_ | |
| `invoice.created` | _pending_ | |
| `invoice.finalized` | _pending_ | |
| `invoice.paid` | _pending_ | |
| `invoice.payment_failed` | _pending_ | |
| `invoice.payment_action_required` | _pending_ | |
| `charge.dispute.created` | _pending_ | |

## Known caveats

- `checkout.session.completed` requires Phase 4 wiring (Checkout flow with
  `metadata.firm_id`) to land first. The handler exists in this branch
  but has no upstream caller until Phase 4 ships. For Phase 3 verification
  only, use `stripe fixtures` with hand-rolled `firm_id` metadata or skip
  this event and re-verify in Phase 4.
- Handlers throw on missing `subscription.metadata.firm_id`. Make sure
  fixtures inject `firm_id` matching a real Clerk org id, otherwise Stripe
  will retry every webhook for 72h.

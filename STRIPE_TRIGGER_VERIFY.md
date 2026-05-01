# Stripe trigger verification — billing Phase 3

Manual verification gate for `feature/billing-phase-3` before merge.
Runs each Stripe event end-to-end against a local dev server and confirms
the webhook handler chain (signature verify → idempotency insert → handler
dispatch → DB write → Clerk metadata sync → audit row) executes cleanly.

**Verified 2026-04-30** against Neon `dev` branch (`br-curly-cell-amew7wcr`)
with Stripe CLI 1.40.9 against the `Foundry Finance LLC sandbox` test-mode
account. See "Results" section below.

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

| Event | Date verified | Result | Notes |
|---|---|---|---|
| `checkout.session.completed` | 2026-04-30 | _deferred_ | Phase 4 — handler creates real Clerk dev orgs as side-effect; covered by unit tests in this branch. Re-verify live once Checkout flow ships. |
| `customer.subscription.created` | 2026-04-30 | error (expected) | 5 hits across triggers; "missing metadata.firm_id — set on Checkout session creation"; 178–246ms |
| `customer.subscription.updated` | 2026-04-30 | error (expected) | 2 hits; same throw; 172–212ms |
| `customer.subscription.deleted` | 2026-04-30 | error (expected) | 1 hit; "missing metadata.firm_id"; 169ms |
| `customer.subscription.paused` | 2026-04-30 | error (expected) | 1 hit; same throw; 182ms |
| `customer.subscription.trial_will_end` | 2026-04-30 | error (expected) | 2 hits; same throw; 186–230ms |
| `invoice.created` | 2026-04-30 | error (expected) | 10 hits; "missing firm_id or customer"; 238–5813ms (Stripe API latency) |
| `invoice.finalized` | 2026-04-30 | error (expected) | 9 hits; same throw; 218–1167ms |
| `invoice.paid` | 2026-04-30 | error (expected) | 6 hits; same throw; 234–1345ms |
| `invoice.payment_failed` | 2026-04-30 | error (expected) | 2 hits; "missing subscription or firm_id"; 315–1092ms |
| `invoice.payment_action_required` | 2026-04-30 | error (expected) | 1 hit; "missing firm_id"; 727ms |
| `charge.dispute.created` | 2026-04-30 | **ok** | Full success path — 557ms; audit row `billing.dispute_created` written with `firm_id="unknown"` fallback (charge.metadata had no firm_id, expected for bare trigger). |

## Results

**Pipeline paths verified end-to-end** (Phase 3 Option A — limited verification;
firm_id-bound success paths re-verified in Phase 4 once Checkout sets it):

| Path | Verified via | Detail |
|---|---|---|
| Signature verification | live | 158 events forwarded, zero 400s |
| Idempotency `ON CONFLICT DO NOTHING` | unit | `soc2: CC7.5` at `route.test.ts:64` |
| Dispatch fall-through `ignored` | live | 89 rows across 16 prereq event types, all `processing_duration_ms ≈ 0` |
| Handler success | live | `charge.dispute.created` → `result='ok'` + audit row |
| Handler error path | live | 39 rows across 7 firm_id-bound handlers; descriptive `error_message`; `subscriptions`/`subscription_items`/`invoices` stayed at 0 rows (no partial writes) |
| HTTP 500 on handler throw | live | Stripe will retry (72h backoff) — confirmed in `stripe listen` output |

## Known caveats

- `checkout.session.completed` deferred to Phase 4 verification — handler
  creates real Clerk dev orgs as a side effect of a successful run, so it's
  unsafe to fire blindly in test mode. Unit tests cover the handler logic
  in this branch.
- Handlers throw on missing `subscription.metadata.firm_id`. Phase 4
  Checkout flow must stamp `firm_id` on the subscription before any of
  these events fire in production, or Stripe will retry every webhook
  for 72h.

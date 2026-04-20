# Security Runbook

Operational steps that live outside the codebase. Review at each SOC-2
evidence-gathering cycle.

---

## 1. Azure OpenAI abuse-monitoring exemption (audit C6)

**Why:** Azure OpenAI retains prompt + completion content for 30 days by
default for abuse monitoring. Our extract pipeline sends full client
statements (names, balances, SSNs, beneficiaries) to the model. Storing
that PII outside the DPA's declared boundary is a SOC-2 finding and
probably a breach of the advisor engagement letter.

**Steps:**

1. Sign into the Azure portal with the tenant owner of the OpenAI
   resource that backs `AZURE_ENDPOINT`.
2. Submit the *Modified Abuse Monitoring Application* form at
   <https://aka.ms/oai/modifiedaccess>. You're asking for "no abuse
   monitoring / no human review" — the strictest tier.
3. Reference the subscription id and resource name (both in the portal
   on the resource's Overview blade).
4. Approval is usually 3-7 business days. Microsoft responds by email.
5. Once approved, the exemption is automatic at the resource level — no
   code change. Capture the approval email as SOC-2 evidence.

**Until approved:** treat the extract endpoint as out-of-band for
real client data. Dev/test fixtures only.

**Owner:** Dan. Next review: 2026-07-20.

---

## 2. Upstash Redis provisioning (required by /api/clients/[id]/extract)

**Why:** `/api/clients/[id]/extract` fails closed (HTTP 503) without
`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`. In-memory
rate-limiters reset per serverless container — inadequate for a SOC-2
attestation that says "we rate-limit expensive PII-bearing endpoints".

**Steps:**

1. <https://upstash.com> — create a Redis database. Region: closest to
   Vercel deployment (likely `us-east-1`).
2. Copy the *REST URL* and *REST Token* from the database's details
   page.
3. In Vercel project → Settings → Environment Variables, add to
   Production + Preview:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
4. Redeploy production (one-click from Vercel). The rate-limit module
   reads env vars lazily — no rebuild needed beyond the deploy.
5. Smoke-test: hit `/api/clients/<id>/extract` six times in a minute.
   Seventh should return 429 with `Retry-After`. Confirm in Upstash's
   analytics tab that `rl:extract:*` keys are incrementing.

**Budget:** free tier is 10k commands/day, plenty for today's usage.
Upgrade the day a firm hits 500+ extractions/month.

**Owner:** Dan. Next review: first day `/extract` sees 100 prod calls.

---

## 3. CSP report-only → enforce

`next.config.ts` currently ships
`Content-Security-Policy-Report-Only` so we can observe violations
without breaking the app. Flip to enforcing once:

1. Add a `/api/csp-report` endpoint that logs report bodies (schema:
   <https://www.w3.org/TR/CSP3/#report-sample>).
2. Add `report-uri /api/csp-report; report-to csp` directives to the
   CSP string.
3. Run for ≥ 2 weeks with real production traffic. Triage every unique
   `violated-directive`.
4. Once the only reports are known-safe cases, rename the header to
   `Content-Security-Policy` (drop `-Report-Only`).

**Owner:** Dan. Tracked in `docs/FUTURE_WORK.md`.

---

## 4. Quarterly dependency review

1. `npm audit --production` — investigate everything critical/high.
2. `npx npm-check-updates` — read major-version changelogs for every
   package that shipped a new major.
3. Look specifically at: `@clerk/nextjs`, `drizzle-orm`, `drizzle-kit`,
   `next`, `exceljs`, `@upstash/*`, `openai`. Each one sits on the
   critical path.
4. Record the review in the SOC-2 evidence folder with the audit
   output and any decisions to defer updates.

**Owner:** Dan. Next review: 2026-07-20.

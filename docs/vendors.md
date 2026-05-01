# Foundry Planning — Subprocessors & Vendors

Last updated 2026-05-01. Linked from [`/legal/dpa`](/legal/dpa).

This list names every third-party service that processes Foundry Planning
customer data on our behalf. We update it whenever a subprocessor is added
or removed.

## Production subprocessors

| Vendor | Role | Data category | Compliance | DPA |
|---|---|---|---|---|
| **Stripe, Inc.** | Payment processing, subscription management, customer portal | Payment instruments, billing identity, billing email, firm name | PCI DSS Level 1 · SOC 1/2 Type II · ISO 27001 | https://stripe.com/legal/dpa |
| **Clerk, Inc.** | Authentication, organization membership, MFA, password hygiene | Advisor identity, email, MFA factors, session tokens | SOC 2 Type II · GDPR-aligned | https://clerk.com/legal/dpa |
| **Neon (Databricks)** | Managed Postgres for application data | All advisor + client financial data | SOC 2 Type II · ISO 27001 · HIPAA-eligible | https://neon.tech/dpa |
| **Vercel Inc.** | Application hosting, edge runtime, build & deployment | Application traffic metadata, build logs | SOC 2 Type II · ISO 27001 · GDPR-aligned | https://vercel.com/legal/dpa |
| **Functional Software, Inc. (Sentry)** | Error tracking, performance telemetry | Stack traces (PII redacted), advisor identity for error correlation | SOC 2 Type II · ISO 27001 · HIPAA-eligible | https://sentry.io/legal/dpa/ |
| **Upstash, Inc.** | Edge Redis for rate limiting | Anonymized request keys (IP hashes, firm IDs) | SOC 2 Type II · GDPR-aligned | https://upstash.com/legal/dpa |
| **Microsoft Corporation (Azure OpenAI)** | Document extraction for AI Import | Document contents uploaded by advisors during AI Import (no model training) | SOC 1/2/3 · ISO 27001/27017/27018/27701 · HIPAA-eligible | https://servicetrust.microsoft.com |

## Notes

- **No model training on customer data.** Azure OpenAI is configured with
  the "no training" tenancy default; uploaded documents are not used to
  improve underlying models.
- **Sub-processor changes.** Foundry Planning will give 30 days' notice
  before adding or replacing a sub-processor that processes client PII.
  Notice is sent to each firm's billing-owner email of record. Firms may
  object during the notice window per their DPA.
- **Data residency.** Application data is stored in US regions (Neon US
  East). Stripe data follows Stripe's residency policy; Clerk data follows
  Clerk's. We do not currently offer EU residency.
- **Vendor risk reviews.** Foundry Planning reviews each subprocessor's
  current SOC 2 / ISO report annually and on any reported incident.

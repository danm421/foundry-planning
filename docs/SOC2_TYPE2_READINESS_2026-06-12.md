# Foundry Planning — SOC 2 Type 2 Readiness Assessment

**Date:** 2026-06-12
**Engagement type:** Readiness / gap analysis (NOT an attestation). This document simulates what an
external CPA firm would tell you in a pre-audit readiness review, graded against the 2017 AICPA Trust
Services Criteria (TSC).
**Subject:** Foundry Planning — multi-tenant SaaS storing financial PII (SSNs, balances, holdings,
beneficiaries, estate/insurance/tax data) for RIA / financial-advisor firms.
**Critical context:** **solo-developer company.** One person is the entire engineering, operations,
and security function. This fact drives the verdict more than any code finding.

---

## 1. Bottom line

**You are NOT ready to begin a Type 2 observation window today.** Three structural reasons, none of
which are about your code quality:

1. **No operating history / no evidence machinery.** Type 2 attests that controls *operated
   effectively over a period* (typically 3–12 months). You currently produce almost none of the
   recurring evidence an auditor samples (access-review records, change approvals, vuln-scan reports,
   backup-restore tests, risk-assessment minutes, training records). A perfectly designed control with
   no operating evidence **fails** a Type 2 test.
2. **No policy framework.** SOC 2 expects a written, approved, communicated set of information-security
   policies. You have excellent *technical* documentation but effectively zero *governance* policy.
3. **Segregation of duties (SoD).** As a solo dev you write, review, approve, deploy, hold every
   secret, and have unrestricted production-database access. This is the hardest SOC 2 control to
   satisfy and must be addressed with **compensating automated controls** plus documented
   acknowledgement of the residual risk.

**What's genuinely good:** your *security design* — the half most startups fail — is strong. Tenant
isolation, audit logging, fail-closed rate limiting, signed webhooks, hardened security headers, a real
subprocessor register, and a demonstrated closed-loop AppSec remediation history all give an auditor
real design evidence to credit.

### Realistic timeline to a Type 2 report

| Phase | Work | Duration |
|---|---|---|
| **0 — Remediate blockers + write policies** | Close the gating items below; adopt a policy set; stand up a compliance-automation platform (Vanta / Drata / Secureframe) to auto-collect evidence | 4–8 weeks |
| **1 — SOC 2 Type 1** | Point-in-time examination of *design*. Achievable once policies + controls exist. Gives you a sellable report fast. | +3–4 weeks |
| **2 — Accumulate operating evidence** | Run the control machinery; let the platform collect artifacts | 3–6 months minimum |
| **3 — SOC 2 Type 2** | Examination over the observation window | concludes the window |

**Net: ~3 months to a Type 1, ~9–12 months to a credible Type 2.** Do not let anyone sell you a
"30-day Type 2" — the observation period is the point of the report.

### Category readiness summary

| TSC Category | Design | Operating evidence | Readiness |
|---|---|---|---|
| CC1 Control Environment / HR | Absent | None | 🔴 Blocker |
| CC2 Communication & Information | Partial | None | 🟠 High |
| CC3 Risk Assessment | Absent | None | 🔴 Blocker |
| CC4 Monitoring Activities | Partial (ad-hoc) | Partial (audit history) | 🟠 High |
| CC5 Control Activities / SoD | Partial | Partial | 🔴 Blocker (SoD) |
| CC6 Logical Access | **Strong** | Insufficient (no reviews) | 🟡 Medium |
| CC6 Encryption / Secrets | Good design, **secret-exposure open** | N/A | 🔴 Blocker (secrets) |
| CC7 Operations / Incident Response | Partial | None (no IR plan) | 🟠 High |
| CC8 Change Management / SDLC | Partial | Partial (git/PR) | 🟠 High |
| CC9 Vendor Mgmt / Risk Mitigation | **Good** (vendors.md) | Partial | 🟡 Medium |
| Availability (A1) | Inherited + gaps | None (no restore test) | 🟠 High |
| Confidentiality (C1) | Good | Partial | 🟡 Medium |
| Processing Integrity (PI1) | Partial | Partial (tests not green) | 🟡 Medium (if in scope) |
| Privacy (P) / GLBA / Reg S-P | Partial | None | 🟠 High |

*Recommended initial scope:* **Security (required) + Confidentiality + Availability.** Defer Processing
Integrity and the Privacy category until the base is mature (but address the GLBA/Reg S-P regulatory
overlay now — your RIA customers will ask regardless of SOC 2 scope).

---

## 2. Gating blockers — fix before a Type 2 window can start

| # | Blocker | TSC | Why it blocks |
|---|---|---|---|
| **B1** | **Exposed/unrotated secrets.** `SECURITY_HARDENING_LOG.md` flags Clerk **TEST** keys in production, the Upstash REST token "shared in chat transcript — rotate," and an exposed Vercel personal token. | CC6.1, CC6.7 | A known-exposed, unrotated production credential is an automatic exception. Rotate all three, move to least-privilege scoped tokens, and document a rotation policy. |
| **B2** | **No policy framework.** No InfoSec, Access Control, Change Mgmt, IR, BCP/DR, Risk Assessment, Vendor, Data-Classification/Retention, Encryption, Logging, SDLC, or HR policies. | CC1.1, CC2.2, CC5.3 | SOC 2 is policy-anchored; auditors test whether you *do what your policies say*. No policies = nothing to test against. |
| **B3** | **No risk assessment.** No risk register, no fraud-risk consideration, no recurring cadence. Point-in-time AppSec audits ≠ a formal risk-assessment process. | CC3.1–CC3.4 | CC3 is foundational; the entire control set is supposed to be *driven by* a documented risk assessment. |
| **B4** | **Segregation of duties / key-person risk.** Solo dev self-approves and self-deploys all changes with full prod DB access; no independent oversight. | CC1.3, CC5.1, CC8.1 | Pure SoD is impossible solo. You must implement *compensating controls* (branch protection requiring CI gates, immutable deploy history, audit logging, restricted/just-in-time prod access) and have management formally accept the residual risk. |
| **B5** | **No operating evidence / no audit period defined.** No access reviews, change approvals, vuln-scan reports, backup tests, or monitoring records being generated on a schedule. | CC4.1, all "operating" tests | You cannot pass Type 2 without months of these artifacts. Stand up evidence automation **now** so the clock can start. |
| **B6** | **Azure OpenAI abuse-monitoring exemption not confirmed.** Per `SECURITY_RUNBOOK.md §1`, Azure retains prompt+completion content (incl. SSNs) for 30 days unless the Modified Abuse Monitoring exemption is approved; runbook says treat extract as "dev/test fixtures only" until then. | C1.1, P4 | If real client PII flows to Azure without the exemption, sensitive data sits outside your declared DPA boundary — a confidentiality finding and likely a breach of advisor engagement terms. Confirm approval (capture the email) before processing real data. |

---

## 3. What is already strong — preserve it

The auditor would credit these as **design** evidence (operating evidence still needs to accumulate):

- **Tenant isolation is enforced at the handler + DB layer** (`requireOrgId()` / `requireClientAccess()`,
  firm-scoped queries), independent of the bypassable Clerk middleware; returns **404 not 403** so
  existence never leaks. Backed by a contract test (`src/__tests__/tenant-isolation.test.ts`) and FK
  validation discipline (`src/lib/db-scoping.ts`). *This is the crown-jewel control for a multi-tenant
  PII app and it is done right.*
- **Audit logging** (`src/lib/audit.ts`, `audit_log` table) on destructive mutations, including a
  `billing.access_denied` trail in middleware → real CC7.2 detective evidence.
- **Fail-closed rate limiting** (`src/lib/rate-limit.ts`, Upstash) on expensive/PII-bearing endpoints.
- **Signed webhooks** (Clerk via svix, Stripe signature on raw body) with an idempotency table.
- **Crons self-protect** with a Bearer `CRON_SECRET` (fail-closed when unset).
- **Hardened security headers**: HSTS w/ preload, `X-Frame-Options: DENY`, `frame-ancestors 'none'`,
  nosniff, Referrer-Policy, Permissions-Policy, COOP.
- **Extraction hardening**: SSN redaction before the LLM call, strict zod output validation, magic-byte
  + page-cap + timeout on the PDF path.
- **Subprocessor register** (`docs/vendors.md`) with compliance status, DPAs, 30-day change notice, and
  a committed annual vendor-review — genuinely good CC9.2 design.
- **Closed-loop AppSec remediation history** (April audit → hardening log → June re-audit with
  adversarial verification) — demonstrates a *monitoring & remediation* habit (CC4) you can formalize.
- **All meaningful infrastructure runs on SOC 2 Type II / ISO 27001 subservice orgs** (Vercel, Neon,
  Clerk, Stripe, Sentry, Upstash, Azure), so physical security, host hardening, and encryption-at-rest
  infrastructure are inheritable under the carve-out method.

---

## 4. Detailed gap register by TSC category

> Severity key: 🔴 Blocker · 🟠 High (fix before the window) · 🟡 Medium (fix during the window) · ⚪ Low/maturity.

### CC1 — Control Environment, Governance & HR
No governance policies, no documented roles/responsibilities, no oversight structure, no HR controls.
Solo operation means no independent accountability and high key-person risk.

| Criterion | Gap | Sev | Remediation |
|---|---|---|---|
| CC1.1 | No code of conduct / ethics / InfoSec commitment doc | 🟠 | Adopt InfoSec policy + code of conduct; sign annually |
| CC1.2/1.3 | No oversight body; solo self-governs | 🔴 | Define org structure even at N=1; consider an external advisor/fractional CISO for independent review; document SoD compensations |
| CC1.4 | No security awareness training; no competence evidence | 🟠 | Complete annual security training; keep the certificate as evidence |
| CC1.5 | No accountability/performance mechanism for control duties | 🟡 | Assign control owners (all "Dan" today) with named responsibilities in policy |
| CC1.4 | No background check / confidentiality agreement on file | 🟡 | Self-execute a confidentiality agreement; background check before first hire; build onboarding/offboarding checklist now |

### CC2 — Communication & Information
Subprocessor communication (vendors.md, 30-day notice) is good. Missing: a documented **system
description** (required for the SOC 2 report itself), published security commitments, and a security
contact / vulnerability-disclosure channel.

| Criterion | Gap | Sev | Remediation |
|---|---|---|---|
| CC2.1 | No formal system description / boundary doc | 🟠 | Write the SOC 2 system description (services, boundaries, data flows, subprocessors) — you'll need it for the report anyway |
| CC2.2 | Policies not communicated (none exist) | 🟠 | Publish policies; acknowledge them (B2) |
| CC2.3 | No public security page / `security.txt` / VDP; verify `/legal/dpa` page actually exists (referenced by vendors.md) | 🟡 | Add `/.well-known/security.txt`, a security/trust page, and confirm DPA + privacy pages are live |

### CC3 — Risk Assessment
Absent as a formal process. AppSec audits are point-in-time, not a recurring risk-assessment program,
and don't cover fraud or change risk.

| Criterion | Gap | Sev | Remediation |
|---|---|---|---|
| CC3.1–3.2 | No risk register with likelihood/impact/owner/treatment | 🔴 | Build a risk register; review at least annually + on major change |
| CC3.3 | No fraud-risk consideration (e.g. billing fraud, insider misuse) | 🟡 | Add fraud scenarios to the register |
| CC3.4 | No process to assess control impact of changes | 🟠 | Add a "security impact" step to change management (CC8) |

### CC4 — Monitoring Activities
You have a real remediation *habit* (April→June audits) but no formalized, scheduled program and no
deficiency tracker with owners/dates.

| Criterion | Gap | Sev | Remediation |
|---|---|---|---|
| CC4.1 | No scheduled control self-assessment; no automated control monitoring | 🟠 | Adopt evidence-automation tooling; schedule quarterly self-assessments |
| CC4.1 | No automated dependency/vuln scanning (no Dependabot/Renovate); deps are behind (`next`, `@clerk/*`, `xlsx`) | 🟠 | Enable Dependabot/Renovate + scheduled `npm audit`; patch the open Highs |
| CC4.2 | Findings not tracked to closure in a system of record | 🟡 | Track findings (incl. the June audit's 50) with owner + due date |

### CC5 — Control Activities & Segregation of Duties
The central solo-dev problem. See **B4**. Compensating controls exist (audit log, CI, git history) but
are not yet formalized or sufficient on their own.

| Criterion | Gap | Sev | Remediation |
|---|---|---|---|
| CC5.1 | No SoD between dev/approve/deploy/prod-access | 🔴 | Branch protection requiring green CI; immutable Vercel deploy log; restrict + log prod DB access; document residual-risk acceptance |
| CC5.2/5.3 | Controls not deployed via written procedures | 🟠 | Convert your `AGENTS.md` workflow into an approved SDLC/change policy |

### CC6 — Logical & Physical Access (design is strong; reviews missing)
Authorization & tenant isolation are a genuine strength. Gaps are in **MFA enforcement evidence**,
**periodic access reviews**, and **restricting privileged prod access**.

| Criterion | Gap | Sev | Remediation |
|---|---|---|---|
| CC6.1 | MFA *capability* exists (Clerk) but enforcement not evidenced; password/session policy not documented | 🟠 | Enforce MFA org-wide in Clerk; screenshot the setting; document the auth policy *(management request — Clerk dashboard)* |
| CC6.2/6.3 | No periodic access review / recertification; no joiner-mover-leaver procedure | 🟠 | Quarterly access review of Clerk users + Vercel/Neon/Stripe/GitHub admins; keep signed evidence |
| CC6.1 | Unrestricted, unreviewed prod DB access (full `DATABASE_URL` to one person) | 🔴 | Restrict/just-in-time prod access; log it; document why solo access is risk-accepted |
| CC6.6/6.7 | Encryption in transit ✅ (HSTS); at rest inherited (Neon/Vercel/Blob) — confirm + record as CUEC | 🟡 | Capture vendor encryption attestations as evidence |
| CC6.7 | **Secret exposure open (B1)**; no rotation policy | 🔴 | Rotate B1 secrets; write a key-management/rotation policy |
| CC6.6 | CSP is **Report-Only** + `'unsafe-inline'/'unsafe-eval'` → no runtime XSS containment | 🟡 | Nonce-based CSP, then flip to enforcing (per runbook §3) |

### CC7 — System Operations, Detection & Incident Response
Detection inputs exist (Sentry, audit log, alerts) but there is **no incident-response plan**. The
security runbook is operational, not an IR plan (no severity tiers, roles, comms, or breach
notification).

| Criterion | Gap | Sev | Remediation |
|---|---|---|---|
| CC7.1 | No vuln-management *program* (cadence/SLAs); deps behind | 🟠 | Define patch SLAs; automate scanning (see CC4) |
| CC7.2 | Detection exists but no documented log review/alerting runbook; Sentry `enableLogs:true` with no `beforeSend` PII scrubber | 🟡 | Add a Sentry scrubber (reuse `redact-ssn.ts`); document alert triage |
| CC7.3–7.5 | **No incident-response plan**; no breach-notification process (heavy for financial PII — state laws + GLBA + Reg S-P) | 🟠 | Write an IR plan: severity tiers, roles, comms, regulator/customer breach notification, post-incident review; run one tabletop and keep the record |

### CC8 — Change Management & SDLC
A worktree→PR→merge workflow exists (`AGENTS.md`) but merges are self-approved and **CI gates only
`tsc --noEmit`** — tests and lint are explicitly *not* gated (baseline failures on main). Migration
control via Drizzle is reasonable.

| Criterion | Gap | Sev | Remediation |
|---|---|---|---|
| CC8.1 | Self-approved changes; no enforced review/approval gate | 🟠 | Branch protection; require green CI; document an emergency-change path; even self-merge with a recorded checklist + CI evidence is defensible |
| CC8.1 | CI doesn't run tests/lint; suite not green | 🟠 | Get the suite to a green baseline, then gate tests + lint in `ci.yml` |
| CC8.1 | Deploy authorization / rollback not documented (Vercel provides the capability) | 🟡 | Document the deploy + rollback procedure; Vercel's immutable deploy log is good evidence |

### CC9 — Risk Mitigation: Vendor Management & BCP
`vendors.md` is strong design. Gaps: **evidence** the annual vendor review actually runs, executed DPAs
on file, and **cyber/E&O insurance**.

| Criterion | Gap | Sev | Remediation |
|---|---|---|---|
| CC9.1 | No cyber-liability / tech-E&O insurance evidence | 🟠 | Obtain cyber + E&O coverage (customers and auditors ask); keep the binder |
| CC9.2 | Annual subprocessor SOC-2/ISO review committed but not evidenced; DPA execution not tracked | 🟡 | Actually collect + review each vendor's current SOC 2 report yearly; store executed DPAs |

### Availability (A1)
Mostly inherited infrastructure, but the **entity-owned CUECs are missing**: confirmed backups,
**tested restoration**, RTO/RPO, a DR plan, and uptime monitoring (Sentry is errors, not uptime).

| Criterion | Gap | Sev | Remediation |
|---|---|---|---|
| A1.2 | Neon PITR likely available but backup config + **restore testing** not evidenced | 🟠 | Confirm Neon backup/PITR; perform + document a restore test (an untested backup is an exception) |
| A1.2 | No DR plan; no RTO/RPO | 🟠 | Write a DR plan with RTO/RPO; do a recovery exercise |
| A1.1/1.3 | No uptime/status monitoring or capacity plan | 🟡 | Add uptime monitoring (e.g. a status/uptime service); document capacity (Upstash free-tier note) |

### Confidentiality (C1)
Good handling design (SSN redaction, US residency, no-training Azure, purge cron). Missing: a **data
classification scheme** and a written **retention/disposal schedule**.

| Criterion | Gap | Sev | Remediation |
|---|---|---|---|
| C1.1 | No data-classification policy | 🟡 | Classify data (e.g. Restricted = SSN/financial PII); tag handling rules |
| C1.2 | Retention/disposal not formalized (purge-expired-firms cron is good evidence — back it with a policy) | 🟡 | Write a retention schedule; document the firm-offboarding deletion + data-subject deletion path |
| C1.1 | **Azure PII boundary (B6)** | 🔴 | Confirm the abuse-monitoring exemption before real-data extraction |

### Processing Integrity (PI1) — *optional; recommend deferring scope*
Relevant because advisors rely on the projection engine. Input validation (zod) has known gaps per the
June audit, and the **test suite is not green** — a processing-integrity assurance weakness if claimed.

| Criterion | Gap | Sev | Remediation |
|---|---|---|---|
| PI1.2 | Some routes lack zod `.strict()` (June audit M5 + lows) | 🟡 | Complete input-validation coverage |
| PI1.3/1.4 | Test suite has baseline failures → weak processing-accuracy evidence | 🟡 | Green the engine test suite before claiming PI scope |

### Privacy (P) & Regulatory Overlay — GLBA / SEC Reg S-P / state law
Even if you exclude the SOC 2 Privacy category, your RIA customers operate under **SEC Regulation S-P**
and **GLBA Safeguards Rule (16 CFR 314)**; as their data processor you'll be asked to demonstrate a
written information-security program and breach procedures. Treat this as a parallel obligation.

| Criterion | Gap | Sev | Remediation |
|---|---|---|---|
| P1/P5 | Privacy notice + data-subject-rights (access/deletion) process not evidenced | 🟠 | Publish a privacy notice; document DSAR/deletion handling |
| GLBA/Reg S-P | No documented determination of obligations as a processor of RIA client records | 🟠 | Document your role (processor), the safeguards program, and breach-notification flow-down to advisor firms |

---

## 5. The Type 2 operating-evidence problem (read this twice)

Design ≠ a Type 2 pass. The examiner samples **artifacts generated over the period** to prove each
control *ran*. Start generating these **now** so the observation window has something to sample:

- **Access reviews** — quarterly recertification of Clerk users + Vercel/Neon/Stripe/GitHub/Upstash
  admins, signed and dated.
- **Change approvals** — every prod change tied to a PR with CI evidence (and a recorded self-review
  checklist given solo).
- **Vulnerability scans** — scheduled `npm audit` / Dependabot output, archived, with remediation dates.
- **Backup-restore tests** — at least one documented restore drill.
- **Risk assessment** — annual (or on major change) with dated minutes.
- **Vendor reviews** — each subprocessor's current SOC 2 report collected + reviewed yearly.
- **Security training** — annual completion certificate.
- **Incident log + one tabletop** — even "zero incidents" is evidenced by the monitoring records.
- **Monitoring** — uptime + error + audit-log review cadence.

**Strong recommendation:** adopt a compliance-automation platform (**Vanta / Drata / Secureframe**).
For a solo founder it replaces most manual evidence collection by integrating directly with GitHub,
Vercel, Neon, Clerk, AWS/Azure, and an MDM — and is effectively the only practical way one person runs
a Type 2 evidence program.

---

## 6. Subservice organizations & complementary user-entity controls (CUECs)

Your report will use the **carve-out method**: these vendors' controls are excluded but relied upon.
You must still operate the CUECs.

| Subservice org | Inherited controls | Your CUECs |
|---|---|---|
| **Vercel** | Hosting, network, DDoS/WAF, build infra, physical | Configure security headers; manage env vars/secrets; restrict project access; review deploy log |
| **Neon** | Managed Postgres, encryption at rest, infra backups | Enable/verify PITR; **test restore**; restrict the connection string; review DB access |
| **Clerk** | Auth infra, MFA capability, password hygiene, session | **Enforce MFA**; configure session/password policy; review users; least-privilege roles |
| **Stripe** | PCI DSS L1 payment handling | Verify webhook signatures (✅); restrict dashboard access; reconcile billing |
| **Sentry** | Error infra | Configure PII scrubbing; restrict access; review alerts |
| **Upstash** | Redis infra | Rotate tokens (B1); restrict access |
| **Azure OpenAI** | Model infra, SOC/ISO/HIPAA | **Confirm abuse-monitoring exemption (B6)**; no-training config (✅); redact SSNs pre-send (✅) |

---

## 7. Required policy set (you have ~none of these)

InfoSec (master) · Access Control · Change Management / SDLC · Incident Response · Business Continuity &
Disaster Recovery · Risk Assessment & Management · Vendor / Third-Party Management · Data Classification
& Handling · Data Retention & Disposal · Encryption & Key Management · Logging & Monitoring · Acceptable
Use · HR Security (onboarding/offboarding, training, confidentiality) · Physical Security (can be brief —
mostly inherited / remote).

Use templated starters (your automation platform provides them) and tailor — but they must be approved,
dated, and acknowledged.

---

## 8. Management representations / evidence to provide (not visible in code)

- Clerk dashboard: MFA enforcement, password/session policy, user list
- GitHub: branch-protection settings, who can merge
- Vercel/Neon: access lists, backup/PITR config, deploy/audit logs
- Executed DPAs + current SOC 2 reports for each subprocessor
- Cyber/E&O insurance binder
- Azure modified-abuse-monitoring **approval email**
- Background-check / confidentiality-agreement / training records
- Evidence the credential rotations (B1) were completed (timestamps)

---

## 9. Prioritized remediation roadmap

**Phase 0 — Unblock (Weeks 1–2)**
1. Rotate all exposed secrets; move Clerk to live keys; scope tokens least-privilege **(B1)**.
2. Confirm the Azure abuse-monitoring exemption (or keep real PII off `/extract`) **(B6)**.
3. Enforce MFA in Clerk; enable branch protection requiring green CI.
4. Enable Dependabot/Renovate; patch the open dependency Highs (`next`, `@clerk/*`, `xlsx`).

**Phase 1 — Governance foundation (Weeks 2–6)**
5. Stand up compliance automation (Vanta/Drata/Secureframe) + connect integrations **(B5)**.
6. Adopt the policy set **(B2)**; write the system description.
7. Build the risk register; document SoD compensating controls + residual-risk acceptance **(B3, B4)**.
8. Write the IR plan + BCP/DR plan; run one tabletop + one restore test.
9. Obtain cyber/E&O insurance; collect vendor SOC 2 reports + executed DPAs.

**Phase 2 — Type 1 examination (Weeks 6–10)**
10. Green the test suite; gate tests + lint in CI; complete zod coverage.
11. Engage an auditor for a **Type 1** (design) report — a sellable artifact while you accumulate
    operating history.

**Phase 3 — Operating window → Type 2 (Months 3–9+)**
12. Run the evidence machinery (access reviews, change approvals, scans, monitoring) every cycle.
13. After 3–6 months of clean artifacts, run the **Type 2** examination over the observation window.

---

*Prepared 2026-06-12 as a readiness gap analysis. Grounded in direct review of the codebase and the
existing security documentation (`docs/SECURITY_AUDIT_2026-06-12.md`, `SECURITY_HARDENING_LOG.md`,
`SECURITY_RUNBOOK.md`, `vendors.md`, `.github/workflows/ci.yml`, `package.json`). Not an attestation;
no opinion is expressed. A formal SOC 2 examination must be performed by a licensed CPA firm.*

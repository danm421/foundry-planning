import type { SubscriptionState } from "@/lib/billing/subscription-state";

export type AccessDecision = "allow" | "block_mutation" | "lock_out";

/**
 * Number of days a `past_due` subscription keeps full access before it
 * degrades to read-only. Dunning typically resolves inside this window;
 * past it, Stripe Revenue Recovery will usually have flipped the sub to
 * `unpaid`/`canceled` anyway — this is the belt-and-suspenders schedule so
 * access degrades even if a Dashboard setting is misconfigured.
 */
export const PAST_DUE_GRACE_DAYS = 14;
const PAST_DUE_GRACE_MS = PAST_DUE_GRACE_DAYS * 24 * 60 * 60 * 1000;

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Read-POST allowlist: POST routes that read/compute but mutate nothing, so
 * a read-only (grace/late-past_due) firm may still hit them. Matched by
 * prefix against the request pathname. Keep this list tight — every entry is
 * a hole in mutation-blocking.
 *
 * `/data` report-projection endpoints take a POST body (scenario params) and
 * return projections without writing. Add new read-POST routes here, not by
 * widening the method check.
 */
const READ_POST_PREFIXES = ["/api/clients/", "/api/cma/"] as const;
const READ_POST_SUFFIXES = [
  "/reports/data",
  "/projection",
  "/preview",
  // Forge read turns: stream produces a streamed answer, resume continues
  // after an approval decision. Both READ/compute — Phase 2 writes go through
  // the approval/HITL path with normal mutation gating, so a read-only
  // (grace / late-past_due) firm may still converse with the forge.
  "/forge/stream",
  "/forge/resume",
] as const;

function isReadPost(pathname: string): boolean {
  if (!READ_POST_PREFIXES.some((p) => pathname.startsWith(p))) return false;
  return READ_POST_SUFFIXES.some((s) => pathname.endsWith(s) || pathname.includes(`${s}/`));
}

/**
 * Single source of truth for billing access enforcement (AD-1). Pure — no IO,
 * no Date.now beyond the past_due cutoff, no env. Covered by an exhaustive
 * truth-table test (= SOC-2 CC6.1 operating-effectiveness evidence).
 *
 *  - `lock_out`        canceled_locked / unpaid / paused / missing — block
 *                      reads too.
 *  - `block_mutation`  canceled_grace, comp_ended and late past_due — GET
 *                      (+ read-POST allowlist) allowed, mutating methods
 *                      blocked.
 *  - `allow`           founder / trialing / active / active_canceling, and
 *                      past_due within its cutoff.
 *
 * `missing` (no readable subscription metadata) is an unprovisioned / broken
 * account, not a billing judgment — lock it out entirely. With Clerk
 * auto-org-creation disabled, every real org is provisioned with metadata, so
 * no legitimate user reaches this state; the middleware enforces it
 * unconditionally (see src/proxy.ts), independent of the rollout flag.
 */
export function decideAccess(
  state: SubscriptionState,
  method: string,
  pathname: string,
): AccessDecision {
  switch (state.kind) {
    case "founder":
    case "trialing":
    case "active":
    case "active_canceling":
      return "allow";

    case "canceled_locked":
    case "unpaid":
    case "paused":
      return "lock_out";

    case "past_due": {
      if (state.pastDueSince === null) return "allow";
      const ageMs = Date.now() - state.pastDueSince.getTime();
      if (ageMs < PAST_DUE_GRACE_MS) return "allow";
      return mutationDecision(method, pathname);
    }

    // A comp ending is a business decision, not a broken account: the firm
    // keeps reading its own book while it decides, and is prompted to
    // subscribe. Identical treatment to canceled_grace on purpose — anything
    // harsher would give a de-comped firm LESS access than one that simply
    // stopped paying.
    case "comp_ended":
    case "canceled_grace":
      return mutationDecision(method, pathname);

    case "missing":
      return "lock_out";
  }
}

function mutationDecision(method: string, pathname: string): AccessDecision {
  const m = method.toUpperCase();
  if (!MUTATING_METHODS.has(m)) return "allow";
  if (m === "POST" && isReadPost(pathname)) return "allow";
  return "block_mutation";
}

/**
 * Does a non-"allow" decision actually BLOCK, or only get logged?
 *
 * Single source of truth for the rollout-flag override, shared by `src/proxy.ts`
 * (the web) and `src/lib/mcp/principal.ts` (the MCP connector) — the same R74/R85
 * rule that put `enforcementMode` itself here. Both previously spelled the
 * override out inline, and adding `comp_ended` to one of them broke the other's
 * promise that they "can never drift apart"; this is that promise made
 * structural instead of aspirational.
 *
 * Two states ignore the flag, because neither is a billing-rollout judgment
 * call — one is a broken account, the other a decision ops already took:
 *
 *   `missing`     unprovisioned / broken (no readable subscription metadata).
 *   `comp_ended`  ops ended this firm's Founder comp. Gated on the flag it
 *                 would do nothing visible while the rollout is in "log" mode,
 *                 i.e. the de-comp would silently not work.
 *
 * Written as an exhaustive switch rather than a Set or a `default:` — a new
 * SubscriptionState then fails to compile here until someone decides which
 * side it falls on, which a `default` clause would silently answer for them.
 */
export function isEnforced(
  state: SubscriptionState,
  decision: AccessDecision,
): boolean {
  if (decision === "allow") return false;
  switch (state.kind) {
    case "missing":
    case "comp_ended":
      return true;
    case "founder":
    case "trialing":
    case "active":
    case "active_canceling":
    case "past_due":
    case "canceled_grace":
    case "canceled_locked":
    case "unpaid":
    case "paused":
      return enforcementMode() === "enforce";
  }
}

export type BillingEnforcementMode = "log" | "enforce";

/**
 * Whether a "lock_out"/"block_mutation" decision actually blocks, or only
 * logs. Single source of truth (Task 12 fix round 1 / F2, Ruling R85):
 * `src/proxy.ts` (the web) and `src/lib/mcp/principal.ts` (the MCP
 * connector) both import this rather than each reading
 * `process.env.BILLING_ENFORCEMENT_MODE` independently — a second copy is
 * exactly the drift-able duplicate this file already exists to prevent (see
 * R74, which banned the same pattern for the OAuth issuer).
 */
export function enforcementMode(): BillingEnforcementMode {
  return process.env.BILLING_ENFORCEMENT_MODE === "enforce" ? "enforce" : "log";
}

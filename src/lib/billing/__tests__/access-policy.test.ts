import { describe, it, expect } from "vitest";
import { decideAccess, type AccessDecision } from "../access-policy";
import type { SubscriptionState } from "../subscription-state";

// One representative instance of every SubscriptionState kind.
const NOW = Date.now();
const states: Record<string, SubscriptionState> = {
  founder: { kind: "founder" },
  trialing: { kind: "trialing", trialEndsAt: new Date(NOW + 5 * 86400_000) },
  active: { kind: "active" },
  active_canceling: { kind: "active_canceling", periodEnd: new Date(NOW + 5 * 86400_000) },
  past_due_fresh: { kind: "past_due", pastDueSince: new Date(NOW - 1 * 86400_000) },
  past_due_stale: { kind: "past_due", pastDueSince: new Date(NOW - 20 * 86400_000) },
  past_due_unknown: { kind: "past_due", pastDueSince: null },
  unpaid: { kind: "unpaid" },
  paused: { kind: "paused" },
  canceled_grace: {
    kind: "canceled_grace",
    archivedAt: new Date(NOW - 5 * 86400_000),
    mutationsAllowed: false,
  },
  canceled_locked: { kind: "canceled_locked" },
  missing: { kind: "missing", reason: "no_metadata" },
};

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

// Representative paths. The read-POST allowlist entry is a search/report-data
// POST that mutates nothing; the mutating POST is a normal create.
const READ_POST_PATH = "/api/clients/abc/reports/data";
const MUTATE_PATH = "/api/clients/abc/accounts";
const PAGE_PATH = "/clients/abc";

describe("decideAccess truth table", () => {
  // allow-everything states: every method on every path → allow.
  for (const key of ["founder", "trialing", "active", "active_canceling"]) {
    for (const method of METHODS) {
      it(`${key} + ${method} → allow`, () => {
        expect(decideAccess(states[key], method, MUTATE_PATH)).toBe<AccessDecision>("allow");
        expect(decideAccess(states[key], method, PAGE_PATH)).toBe<AccessDecision>("allow");
      });
    }
  }

  // lock_out states: every method, every path → lock_out (reads blocked too).
  for (const key of ["unpaid", "paused", "canceled_locked"]) {
    for (const method of METHODS) {
      it(`${key} + ${method} → lock_out`, () => {
        expect(decideAccess(states[key], method, MUTATE_PATH)).toBe<AccessDecision>("lock_out");
        expect(decideAccess(states[key], method, PAGE_PATH)).toBe<AccessDecision>("lock_out");
      });
    }
  }

  // block_mutation states: GET allowed, mutating methods blocked.
  for (const key of ["canceled_grace", "past_due_stale"]) {
    it(`${key} + GET → allow`, () => {
      expect(decideAccess(states[key], "GET", PAGE_PATH)).toBe<AccessDecision>("allow");
    });
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      it(`${key} + ${method} (mutating path) → block_mutation`, () => {
        expect(decideAccess(states[key], method, MUTATE_PATH)).toBe<AccessDecision>(
          "block_mutation",
        );
      });
    }
    it(`${key} + POST on read-allowlist path → allow`, () => {
      expect(decideAccess(states[key], "POST", READ_POST_PATH)).toBe<AccessDecision>("allow");
    });
  }

  // past_due within the cutoff still has full access (degrades on a schedule).
  for (const method of METHODS) {
    it(`past_due_fresh + ${method} → allow (within cutoff)`, () => {
      expect(decideAccess(states.past_due_fresh, method, MUTATE_PATH)).toBe<AccessDecision>(
        "allow",
      );
    });
  }

  // past_due with no known start date is treated as within-cutoff (allow) —
  // we never escalate to block without a clock to measure against.
  for (const method of METHODS) {
    it(`past_due_unknown + ${method} → allow`, () => {
      expect(decideAccess(states.past_due_unknown, method, MUTATE_PATH)).toBe<AccessDecision>(
        "allow",
      );
    });
  }

  // missing metadata: a signed-in user with an active org but ZERO readable
  // subscription metadata is an unprovisioned / broken account, not a billing
  // judgment call — lock it out entirely (reads too). With auto-org-creation
  // off, no legitimately-provisioned org reaches this state.
  for (const method of METHODS) {
    it(`missing + ${method} → lock_out`, () => {
      expect(decideAccess(states.missing, method, MUTATE_PATH)).toBe<AccessDecision>(
        "lock_out",
      );
    });
  }

  // Method casing is normalized.
  it("lowercase 'post' is treated as a mutation", () => {
    expect(decideAccess(states.canceled_grace, "post", MUTATE_PATH)).toBe<AccessDecision>(
      "block_mutation",
    );
  });
});

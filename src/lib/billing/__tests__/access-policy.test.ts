import { describe, it, expect, afterEach } from "vitest";
import { decideAccess, isEnforced, type AccessDecision } from "../access-policy";
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
  comp_ended: { kind: "comp_ended" },
  missing: { kind: "missing", reason: "no_metadata" },
};

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

// Representative paths. The read-POST allowlist entry is a search/report-data
// POST that mutates nothing; the mutating POST is a normal create.
const READ_POST_PATH = "/api/clients/abc/reports/data";
const FORGE_READ_POST_PATH = "/api/clients/abc/forge/stream";
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
    it(`${key} + POST on forge stream (read turn) → allow`, () => {
      expect(decideAccess(states[key], "POST", FORGE_READ_POST_PATH)).toBe<AccessDecision>(
        "allow",
      );
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

describe("comp_ended access", () => {
  // A firm whose comp was ended is a BUSINESS decision, not a broken account.
  // It gets the same read-only treatment as a firm whose card lapsed
  // (canceled_grace) — anything harsher would give a de-comped firm LESS
  // access than one that simply stopped paying, which is backwards.
  it("GET → allow (they can still read their book while they decide)", () => {
    expect(decideAccess(states.comp_ended, "GET", PAGE_PATH)).toBe<AccessDecision>("allow");
  });

  for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
    it(`${method} → block_mutation`, () => {
      expect(decideAccess(states.comp_ended, method, MUTATE_PATH)).toBe<AccessDecision>(
        "block_mutation",
      );
    });
  }

  it("never locks out reads the way `missing` does", () => {
    for (const method of METHODS) {
      expect(decideAccess(states.comp_ended, method, MUTATE_PATH)).not.toBe<AccessDecision>(
        "lock_out",
      );
    }
  });

  it("honours the read-POST allowlist, like every other read-only state", () => {
    expect(decideAccess(states.comp_ended, "POST", READ_POST_PATH)).toBe<AccessDecision>("allow");
    expect(decideAccess(states.comp_ended, "POST", FORGE_READ_POST_PATH)).toBe<AccessDecision>(
      "allow",
    );
  });
});

describe("isEnforced — the rollout-flag override, shared by proxy.ts and MCP", () => {
  const saved = process.env.BILLING_ENFORCEMENT_MODE;
  afterEach(() => {
    if (saved === undefined) delete process.env.BILLING_ENFORCEMENT_MODE;
    else process.env.BILLING_ENFORCEMENT_MODE = saved;
  });

  it("never enforces an `allow` decision", () => {
    process.env.BILLING_ENFORCEMENT_MODE = "enforce";
    expect(isEnforced(states.active, "allow")).toBe(false);
  });

  it("blocks missing and comp_ended even in log mode", () => {
    process.env.BILLING_ENFORCEMENT_MODE = "log";
    expect(isEnforced(states.missing, "lock_out")).toBe(true);
    expect(isEnforced(states.comp_ended, "block_mutation")).toBe(true);
  });

  it("defers to the flag for every OTHER state", () => {
    process.env.BILLING_ENFORCEMENT_MODE = "log";
    for (const key of ["canceled_grace", "canceled_locked", "unpaid", "paused"]) {
      expect(isEnforced(states[key], "lock_out")).toBe(false);
    }
    process.env.BILLING_ENFORCEMENT_MODE = "enforce";
    for (const key of ["canceled_grace", "canceled_locked", "unpaid", "paused"]) {
      expect(isEnforced(states[key], "lock_out")).toBe(true);
    }
  });

  it("is the expression BOTH enforcement callers use — no second copy", async () => {
    // The drift this exists to prevent: `src/lib/mcp/principal.ts` used to
    // spell the override out inline, under a comment promising it could never
    // diverge from `src/proxy.ts`. Adding a second flag-ignoring state to the
    // proxy falsified that silently. Neither file may re-implement it.
    const { readFile } = await import("node:fs/promises");
    for (const f of ["src/proxy.ts", "src/lib/mcp/principal.ts"]) {
      const src = await readFile(f, "utf8");
      expect(src).toContain("isEnforced");
      expect(src).not.toMatch(/enforcementMode\(\)\s*===\s*"enforce"/);
    }
  });
});

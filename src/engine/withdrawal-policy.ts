// The household's withdrawal policy: HOW a shortfall is covered from the
// household's liquid accounts (spec 2026-10-29). Framework-free — the
// Assumptions screen, the plan-settings validator, the deck's Assumptions page
// and the projection all read the one definition here.
import type { Account } from "./types";
import { controllingEntity } from "./ownership";

/** The groups a shortfall is drawn from, in the engine's long-standing default
 *  order (Cash → Taxable → Tax-deferred → Roth → Annuities). */
export const WITHDRAWAL_GROUPS = ["cash", "taxable", "tax_deferred", "roth", "annuity"] as const;
export type WithdrawalGroup = (typeof WITHDRAWAL_GROUPS)[number];
export const DEFAULT_WITHDRAWAL_GROUP_ORDER: readonly WithdrawalGroup[] = WITHDRAWAL_GROUPS;

export const WITHDRAWAL_GROUP_LABELS: Record<WithdrawalGroup, string> = {
  cash: "Cash & savings",
  taxable: "Taxable",
  tax_deferred: "Tax-deferred",
  roth: "Roth",
  annuity: "Annuities",
};

/**
 * - `order` — drain the groups top to bottom.
 * - `split` — each year's draw is split across the groups by `splitPct`; a
 *   group that can't cover its share passes the rest down the list.
 * - `proportional` — every account gives in proportion to its balance.
 * - `custom` — the account-by-account rows (`withdrawal_strategies`).
 */
export const WITHDRAWAL_METHODS = ["order", "split", "proportional", "custom"] as const;
export type WithdrawalMethod = (typeof WITHDRAWAL_METHODS)[number];

export interface WithdrawalPolicy {
  method: WithdrawalMethod;
  /** Every group, each once. Also the fallback order for `split`. */
  groupOrder: WithdrawalGroup[];
  /** `split` only: each group's share of the year's draw, as fractions that
   *  total 1. A missing or 0 group is drawn only once the others run out. */
  splitPct?: Partial<Record<WithdrawalGroup, number>>;
  /** Accounts never sold to cover a shortfall (`order` / `split` /
   *  `proportional`). RMDs, transfers, conversions and goal funding still run. */
  excludedAccountIds: string[];
}

/** The group an account is drawn in, by category alone, or null for one that is
 *  never drawn (illiquid assets, an annuitized contract — that money is already
 *  with the carrier). Ownership and household-checking exclusions are the
 *  caller's. Unchanged from the engine's original category ranking. */
export function withdrawalGroupOf(acct: Pick<Account, "category" | "subType" | "annuity">): WithdrawalGroup | null {
  if (acct.category === "cash") return "cash";
  if (acct.category === "taxable") return "taxable";
  if (acct.category === "retirement") {
    // traditional_ira, 401k, 403b, 529, hsa, deferred, other → tax-deferred
    return acct.subType === "roth_ira" ? "roth" : "tax_deferred";
  }
  if (acct.category === "annuity") {
    return acct.annuity?.incomeMode === "annuitized" ? null : "annuity";
  }
  return null;
}

/** The group the household draws an account in for a shortfall, or why it
 *  never does — one rule for the projection's default strategy and the
 *  Assumptions screen's preview. An entity's own gap-fill is separate. */
export function householdDrawGroup(
  acct: Pick<Account, "category" | "subType" | "annuity" | "owners" | "isDefaultChecking">,
): { group: WithdrawalGroup; reason: null } | { group: null; reason: string } {
  if (controllingEntity(acct) != null) return { group: null, reason: "Owned by a trust or business" };
  if (acct.isDefaultChecking) return { group: null, reason: "Household checking — withdrawals refill it" };
  const group = withdrawalGroupOf(acct);
  if (group != null) return { group, reason: null };
  return {
    group: null,
    reason: acct.category === "annuity" ? "Annuitized — already paying income" : "Not a liquid account",
  };
}

const isGroup = (v: unknown): v is WithdrawalGroup =>
  typeof v === "string" && (WITHDRAWAL_GROUPS as readonly string[]).includes(v);
const isMethod = (v: unknown): v is WithdrawalMethod =>
  typeof v === "string" && (WITHDRAWAL_METHODS as readonly string[]).includes(v);
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A stored value as a policy, repaired (unknown or repeated groups dropped,
 *  missing ones appended; bad shares and ids dropped), or null when it isn't
 *  one. The jsonb column is read through this, so a hand-edited row can never
 *  reach the engine malformed. */
export function parseWithdrawalPolicy(raw: unknown): WithdrawalPolicy | null {
  if (!isRecord(raw) || !isMethod(raw.method)) return null;
  const groupOrder: WithdrawalGroup[] = [];
  for (const g of Array.isArray(raw.groupOrder) ? raw.groupOrder : []) {
    if (isGroup(g) && !groupOrder.includes(g)) groupOrder.push(g);
  }
  for (const g of WITHDRAWAL_GROUPS) if (!groupOrder.includes(g)) groupOrder.push(g);

  const excludedAccountIds: string[] = [];
  for (const id of Array.isArray(raw.excludedAccountIds) ? raw.excludedAccountIds : []) {
    if (typeof id === "string" && id !== "" && !excludedAccountIds.includes(id)) excludedAccountIds.push(id);
  }

  const policy: WithdrawalPolicy = { method: raw.method, groupOrder, excludedAccountIds };
  if (isRecord(raw.splitPct)) {
    const splitPct: Partial<Record<WithdrawalGroup, number>> = {};
    for (const [g, v] of Object.entries(raw.splitPct)) {
      if (isGroup(g) && typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1) splitPct[g] = v;
    }
    policy.splitPct = splitPct;
  }
  return policy;
}

/** Sum of a split's shares. */
export function splitTotal(splitPct: Partial<Record<WithdrawalGroup, number>> | undefined): number {
  return Object.values(splitPct ?? {}).reduce((s, v) => s + (v ?? 0), 0);
}

/** First problem with a posted policy as a user-facing message, or null when
 *  it can be saved. `null` itself is fine: it restores the default. */
export function withdrawalPolicyProblem(raw: unknown): string | null {
  if (raw === null) return null;
  if (!isRecord(raw) || !isMethod(raw.method)) return "Choose a withdrawal method.";
  if (raw.groupOrder !== undefined) {
    if (!Array.isArray(raw.groupOrder) || raw.groupOrder.some((g) => !isGroup(g))) {
      return "The withdrawal order lists a group that doesn't exist.";
    }
  }
  if (raw.excludedAccountIds !== undefined) {
    if (!Array.isArray(raw.excludedAccountIds) || raw.excludedAccountIds.some((id) => typeof id !== "string" || id === "")) {
      return "An excluded account is not a valid account.";
    }
  }
  if (raw.method === "split") {
    if (!isRecord(raw.splitPct)) return "Set how the withdrawal is split.";
    for (const [g, v] of Object.entries(raw.splitPct)) {
      if (!isGroup(g)) return "The split names a group that doesn't exist.";
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) {
        return "Each split share must be between 0% and 100%.";
      }
    }
    const total = splitTotal(raw.splitPct as Partial<Record<WithdrawalGroup, number>>);
    if (Math.abs(total - 1) > 0.0001) return "The split must total 100%.";
  }
  return null;
}

/** The policy a plan runs. Nothing saved → today's behaviour exactly: the
 *  account-by-account rows when the client has any, else the default order. An
 *  account-by-account policy with no rows, or a split with nothing to split,
 *  runs as In order (with the saved order and exclusions) rather than drawing
 *  nothing. */
export function resolveWithdrawalPolicy(
  stored: WithdrawalPolicy | null | undefined,
  hasAccountRows: boolean,
): WithdrawalPolicy {
  if (!stored) {
    return {
      method: hasAccountRows ? "custom" : "order",
      groupOrder: [...DEFAULT_WITHDRAWAL_GROUP_ORDER],
      excludedAccountIds: [],
    };
  }
  if (stored.method === "custom" && !hasAccountRows) return { ...stored, method: "order" };
  if (stored.method === "split" && splitTotal(stored.splitPct) <= 0) return { ...stored, method: "order" };
  return stored;
}

const pct = (v: number) => `${Number((v * 100).toFixed(2))}%`;

/** The policy in one line, for scenario change rows and the deck. */
export function describeWithdrawalPolicy(policy: WithdrawalPolicy): string {
  let text: string;
  if (policy.method === "split") {
    const shares = policy.groupOrder
      .filter((g) => (policy.splitPct?.[g] ?? 0) > 0)
      .map((g) => `${pct(policy.splitPct![g]!)} ${WITHDRAWAL_GROUP_LABELS[g]}`);
    text = `Split: ${shares.join(", ")}`;
  } else if (policy.method === "proportional") {
    text = "Proportional to each account's balance";
  } else if (policy.method === "custom") {
    return "Account by account";
  } else {
    text = `In order: ${policy.groupOrder.map((g) => WITHDRAWAL_GROUP_LABELS[g]).join(" → ")}`;
  }
  const n = policy.excludedAccountIds.length;
  return n > 0 ? `${text} · ${n} account${n === 1 ? "" : "s"} never sold` : text;
}

/** A stored (unchecked) value in one line, for scenario change rows; nothing
 *  saved reads "Default". */
export function describeStoredWithdrawalPolicy(raw: unknown): string {
  const policy = parseWithdrawalPolicy(raw);
  return policy ? describeWithdrawalPolicy(policy) : "Default";
}

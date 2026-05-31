import type { Account, DeathTransfer, DrainAttribution } from "../types";
import type { ExternalBeneficiarySummary } from "./shared";

const IRD_ELIGIBLE_SUBTYPES = new Set<Account["subType"]>([
  "traditional_ira",
  "401k",
  "403b",
]);

interface ComputeIrdArgs {
  deathOrder: 1 | 2;
  transfers: DeathTransfer[];
  accounts: Account[];
  externalBeneficiaries: ExternalBeneficiarySummary[];
  irdTaxRate: number;
}

/** True if this transfer targets an eligible (non-spouse, non-charity) IRD recipient. */
function isEligibleIrdTransfer(
  t: DeathTransfer,
  subtypeByAccountId: Map<string, Account["subType"]>,
  charityIds: Set<string>,
): boolean {
  if (t.amount <= 0 || t.sourceAccountId == null) return false;
  const subType = subtypeByAccountId.get(t.sourceAccountId);
  if (subType == null || !IRD_ELIGIBLE_SUBTYPES.has(subType)) return false;
  if (t.recipientKind === "spouse") return false;
  if (
    t.recipientKind === "external_beneficiary" &&
    t.recipientId != null &&
    charityIds.has(t.recipientId)
  ) {
    return false;
  }
  return true;
}

/**
 * Pure: emit one `ird_tax` DrainAttribution per non-spouse, non-charity
 * recipient who inherited at least $1 of pre-tax retirement balance at this
 * death event. Aggregates across multiple eligible source accounts to the
 * same recipient. Returns [] when the rate is 0.
 */
export function computeIrdAttributions(args: ComputeIrdArgs): DrainAttribution[] {
  const { deathOrder, transfers, accounts, externalBeneficiaries, irdTaxRate } = args;

  if (irdTaxRate <= 0) return [];

  const subtypeByAccountId = new Map<string, Account["subType"]>();
  for (const a of accounts) subtypeByAccountId.set(a.id, a.subType);

  const charityIds = new Set<string>();
  for (const eb of externalBeneficiaries) {
    if (eb.kind === "charity") charityIds.add(eb.id);
  }

  type Key = string;
  const totalsByRecipient = new Map<
    Key,
    { recipientKind: DeathTransfer["recipientKind"]; recipientId: string | null; amount: number }
  >();

  for (const t of transfers) {
    if (!isEligibleIrdTransfer(t, subtypeByAccountId, charityIds)) continue;

    const key: Key = `${t.recipientKind}|${t.recipientId ?? ""}`;
    const existing = totalsByRecipient.get(key);
    if (existing) {
      existing.amount += t.amount;
    } else {
      totalsByRecipient.set(key, {
        recipientKind: t.recipientKind,
        recipientId: t.recipientId,
        amount: t.amount,
      });
    }
  }

  const out: DrainAttribution[] = [];
  for (const entry of totalsByRecipient.values()) {
    const ird = entry.amount * irdTaxRate;
    if (ird <= 0) continue;
    out.push({
      deathOrder,
      recipientKind: entry.recipientKind,
      recipientId: entry.recipientId,
      drainKind: "ird_tax",
      amount: ird,
    });
  }
  return out;
}

/**
 * Pure: returns true when at least one eligible IRD transfer (non-spouse,
 * non-charity recipient of a pre-tax retirement balance) exists but
 * `irdTaxRate` is 0 — i.e. the engine would silently produce $0 of IRD tax.
 * Drives the `ird_tax_rate_unset` warning. Predicate mirrors
 * `computeIrdAttributions` exactly so the two never drift.
 */
export function hasUntaxedInheritedIrd(args: Omit<ComputeIrdArgs, "deathOrder">): boolean {
  const { transfers, accounts, externalBeneficiaries, irdTaxRate } = args;

  // Complement of computeIrdAttributions' `irdTaxRate <= 0` early-exit.
  if (irdTaxRate > 0) return false;

  const subtypeByAccountId = new Map<string, Account["subType"]>();
  for (const a of accounts) subtypeByAccountId.set(a.id, a.subType);

  const charityIds = new Set<string>();
  for (const eb of externalBeneficiaries) {
    if (eb.kind === "charity") charityIds.add(eb.id);
  }

  return transfers.some((t) => isEligibleIrdTransfer(t, subtypeByAccountId, charityIds));
}

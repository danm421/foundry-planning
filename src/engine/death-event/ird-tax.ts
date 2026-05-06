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
    if (t.amount <= 0) continue;
    if (t.sourceAccountId == null) continue;

    const subType = subtypeByAccountId.get(t.sourceAccountId);
    if (subType == null || !IRD_ELIGIBLE_SUBTYPES.has(subType)) continue;

    if (t.recipientKind === "spouse") continue;
    if (
      t.recipientKind === "external_beneficiary" &&
      t.recipientId != null &&
      charityIds.has(t.recipientId)
    ) {
      continue;
    }

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

import type {
  DeathTransfer,
  DrainAttribution,
  DrainKind,
  WillResiduaryRecipient,
} from "../types";

const ESTATE_TAX_KINDS: ReadonlySet<DrainKind> = new Set([
  "federal_estate_tax",
  "state_estate_tax",
]);

interface RecipientShare {
  recipientKind: DeathTransfer["recipientKind"];
  recipientId: string | null;
  amount: number;
}

interface ComputeArgs {
  deathOrder: 1 | 2;
  transfers: DeathTransfer[];
  drainTotals: Record<DrainKind, number>;
  residuaryRecipients: WillResiduaryRecipient[];
}

type Key = string;

function keyOf(
  recipientKind: DeathTransfer["recipientKind"] | WillResiduaryRecipient["recipientKind"],
  recipientId: string | null,
): Key {
  return `${recipientKind}|${recipientId ?? ""}`;
}

/**
 * Pure: distribute drain totals across recipients using the residuary-aware
 * rule. Residuary recipients absorb drains in proportion to their residuary
 * percentage; overflow (residuary share < drain) falls back to pro-rata
 * across remaining recipients with positive remaining capacity.
 *
 * Spouse share is exempt from `federal_estate_tax` and `state_estate_tax`
 * (marital deduction). Spouse still bears its pro-rata share of `debts_paid`
 * and `admin_expenses`.
 *
 * Returns an empty array when all drain totals are zero.
 */
export function computeDrainAttributions(
  args: ComputeArgs,
): DrainAttribution[] {
  const { deathOrder, transfers, drainTotals, residuaryRecipients } = args;

  const byKey = new Map<Key, RecipientShare>();
  for (const transfer of transfers) {
    if (transfer.amount <= 0) continue;
    const key = keyOf(transfer.recipientKind, transfer.recipientId);
    const existing = byKey.get(key);
    if (existing) {
      existing.amount += transfer.amount;
    } else {
      byKey.set(key, {
        recipientKind: transfer.recipientKind,
        recipientId: transfer.recipientId,
        amount: transfer.amount,
      });
    }
  }
  const shares = Array.from(byKey.values());

  const out: DrainAttribution[] = [];

  for (const kind of Object.keys(drainTotals) as DrainKind[]) {
    const total = drainTotals[kind];
    if (total <= 0) continue;

    const exemptSpouse = ESTATE_TAX_KINDS.has(kind);
    const eligible = shares.filter((s) =>
      exemptSpouse ? s.recipientKind !== "spouse" : true,
    );
    if (eligible.length === 0) continue;

    let remaining = total;
    const allocated = new Map<Key, number>();

    if (residuaryRecipients.length > 0) {
      const totalResiduaryPct =
        residuaryRecipients.reduce((s, r) => s + r.percentage, 0) || 1;
      const targetByKey = new Map<Key, number>();
      for (const r of residuaryRecipients) {
        targetByKey.set(
          keyOf(r.recipientKind, r.recipientId),
          (r.percentage / totalResiduaryPct) * total,
        );
      }
      for (const s of eligible) {
        const key = keyOf(s.recipientKind, s.recipientId);
        const target = targetByKey.get(key) ?? 0;
        if (target <= 0) continue;
        const taken = Math.min(target, s.amount);
        if (taken > 0) {
          allocated.set(key, (allocated.get(key) ?? 0) + taken);
          remaining -= taken;
        }
      }
    }

    if (remaining > 0.0001) {
      const overflowEligible = eligible.filter((s) => {
        const taken = allocated.get(keyOf(s.recipientKind, s.recipientId)) ?? 0;
        return s.amount - taken > 0.0001;
      });
      const overflowBase = overflowEligible.reduce((sum, s) => {
        const taken = allocated.get(keyOf(s.recipientKind, s.recipientId)) ?? 0;
        return sum + (s.amount - taken);
      }, 0);
      if (overflowBase > 0.0001) {
        for (const s of overflowEligible) {
          const key = keyOf(s.recipientKind, s.recipientId);
          const taken = allocated.get(key) ?? 0;
          const capacity = s.amount - taken;
          const share = (capacity / overflowBase) * remaining;
          allocated.set(key, taken + share);
        }
        remaining = 0;
      }
    }

    for (const s of eligible) {
      const key = keyOf(s.recipientKind, s.recipientId);
      const amount = allocated.get(key) ?? 0;
      if (amount <= 0) continue;
      out.push({
        deathOrder,
        recipientKind: s.recipientKind,
        recipientId: s.recipientId,
        drainKind: kind,
        amount,
      });
    }
  }

  return out;
}

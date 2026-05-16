import type {
  DeathTransfer,
  DrainAttribution,
  DrainKind,
  EstateTaxResult,
  Will,
  WillResiduaryRecipient,
} from "../types";

const ESTATE_TAX_KINDS: ReadonlySet<DrainKind> = new Set([
  "federal_estate_tax",
  "state_estate_tax",
]);

const DRAIN_KINDS = [
  "federal_estate_tax",
  "state_estate_tax",
  "admin_expenses",
  "debts_paid",
] as const satisfies readonly DrainKind[];

const EPSILON = 0.0001;

interface RecipientShare {
  key: string;
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

function keyOf(
  recipientKind: DeathTransfer["recipientKind"] | WillResiduaryRecipient["recipientKind"],
  recipientId: string | null,
): string {
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

  const byKey = new Map<string, RecipientShare>();
  for (const transfer of transfers) {
    if (transfer.amount <= 0) continue;
    const key = keyOf(transfer.recipientKind, transfer.recipientId);
    const existing = byKey.get(key);
    if (existing) {
      existing.amount += transfer.amount;
    } else {
      byKey.set(key, {
        key,
        recipientKind: transfer.recipientKind,
        recipientId: transfer.recipientId,
        amount: transfer.amount,
      });
    }
  }
  const allShares = Array.from(byKey.values());
  const exemptSpouseShares = allShares.filter((s) => s.recipientKind !== "spouse");

  // Pre-compute residuary targets relative to a unit drain so each kind only
  // scales by its total. Each entry: residuary recipient key → fraction of drain.
  const residuaryFractionByKey = new Map<string, number>();
  if (residuaryRecipients.length > 0) {
    const totalPct =
      residuaryRecipients.reduce((s, r) => s + r.percentage, 0) || 1;
    for (const r of residuaryRecipients) {
      residuaryFractionByKey.set(
        keyOf(r.recipientKind, r.recipientId),
        r.percentage / totalPct,
      );
    }
  }

  const out: DrainAttribution[] = [];

  for (const kind of DRAIN_KINDS) {
    const total = drainTotals[kind];
    if (total <= 0) continue;

    const eligible = ESTATE_TAX_KINDS.has(kind) ? exemptSpouseShares : allShares;
    if (eligible.length === 0) continue;

    let remaining = total;
    const allocated = new Map<string, number>();

    if (residuaryFractionByKey.size > 0) {
      for (const s of eligible) {
        const fraction = residuaryFractionByKey.get(s.key) ?? 0;
        if (fraction <= 0) continue;
        const taken = Math.min(fraction * total, s.amount);
        if (taken > 0) {
          allocated.set(s.key, (allocated.get(s.key) ?? 0) + taken);
          remaining -= taken;
        }
      }
    }

    if (remaining > EPSILON) {
      let overflowBase = 0;
      const overflowEligible: RecipientShare[] = [];
      for (const s of eligible) {
        const taken = allocated.get(s.key) ?? 0;
        const capacity = s.amount - taken;
        if (capacity > EPSILON) {
          overflowEligible.push(s);
          overflowBase += capacity;
        }
      }
      if (overflowBase > EPSILON) {
        for (const s of overflowEligible) {
          const taken = allocated.get(s.key) ?? 0;
          const capacity = s.amount - taken;
          allocated.set(s.key, taken + (capacity / overflowBase) * remaining);
        }
        remaining = 0;
      }
    }

    for (const s of eligible) {
      const amount = allocated.get(s.key) ?? 0;
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

/**
 * Build the drain-attribution ledger for a death event using the final
 * EstateTaxResult and the (gross) transfer ledger. At first death there is
 * no creditor drain — pass `creditorDrainTotal: 0`.
 */
export function attributeDrainsToLedger(args: {
  deathOrder: 1 | 2;
  transfers: DeathTransfer[];
  estateTax: Pick<
    EstateTaxResult,
    "federalEstateTax" | "stateEstateTax" | "estateAdminExpenses"
  >;
  creditorDrainTotal: number;
  will: Will | null;
  deceased: "client" | "spouse";
  /** Residuary tier governing this death — only that tier's recipients absorb
   *  drains residuary-first. */
  residuaryTier: "primary" | "contingent";
}): DrainAttribution[] {
  const deceasedWill = args.will && args.will.grantor === args.deceased ? args.will : null;
  const residuaryRecipients = (deceasedWill?.residuaryRecipients ?? []).filter(
    (r) => (r.tier ?? "primary") === args.residuaryTier,
  );
  return computeDrainAttributions({
    deathOrder: args.deathOrder,
    transfers: args.transfers,
    drainTotals: {
      federal_estate_tax: args.estateTax.federalEstateTax,
      state_estate_tax: args.estateTax.stateEstateTax,
      admin_expenses: args.estateTax.estateAdminExpenses,
      debts_paid: args.creditorDrainTotal,
      ird_tax: 0,
    },
    residuaryRecipients,
  });
}

/**
 * Invariant: per-kind drainAttribution sums reconcile to band-level totals.
 * Skips kinds where there are no eligible recipients (e.g. estate-tax kinds
 * when only the spouse received transfers — federal/state tax also = 0 in
 * that case via the marital deduction, so the check is a no-op).
 */
export function assertDrainAttributionsReconcile(
  estateTax: EstateTaxResult,
  errorPrefix: string,
): void {
  const debtsTotal = estateTax.creditorPayoffDebits.reduce(
    (s, d) => s + d.amount,
    0,
  );
  const expected: Record<DrainKind, number> = {
    federal_estate_tax: estateTax.federalEstateTax,
    state_estate_tax: estateTax.stateEstateTax,
    admin_expenses: estateTax.estateAdminExpenses,
    debts_paid: debtsTotal,
    ird_tax: 0,
  };
  const sums: Record<DrainKind, number> = {
    federal_estate_tax: 0,
    state_estate_tax: 0,
    admin_expenses: 0,
    debts_paid: 0,
    ird_tax: 0,
  };
  for (const a of estateTax.drainAttributions) {
    sums[a.drainKind] += a.amount;
  }
  for (const kind of DRAIN_KINDS) {
    const exp = expected[kind];
    const sum = sums[kind];
    if (exp > 0 && Math.abs(sum - exp) > 0.5 && sum > 0) {
      throw new Error(
        `${errorPrefix} drain attribution sum mismatch for ${kind}: got ${sum.toFixed(2)}, expected ${exp.toFixed(2)}`,
      );
    }
  }
}

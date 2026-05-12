/**
 * derive-beneficiary-detail.ts
 *
 * Pure transform: per-recipient breakdown of estate flows. Splits direct
 * receipts (first/second death) from in-trust pass-through (pro-rata estimate
 * via primary-tier beneficiary percentages). Used by BeneficiaryCard's
 * drilldown.
 *
 * Trust pass-through is an *estimate*: we apply the recipient's primary
 * beneficiary percentage to the trust's gross funding. Real distributions
 * depend on trustee discretion, distribution policy, and timing — not modeled
 * here.
 */
import type {
  ClientData,
  DeathTransfer,
  DrainAttribution,
  DrainKind,
} from "@/engine/types";
import type { StateInheritanceTaxResult } from "@/lib/tax/state-inheritance";

export interface BeneficiaryDetail {
  fromFirstDeath: DeathSlice;
  fromSecondDeath: DeathSlice;
  inTrust: TrustPassThrough[];
  /** fromFirstDeath.net + fromSecondDeath.net + Σ inTrust.amount */
  total: number;
}

export interface DeathSlice {
  /** Sum of gross transfer amounts to this recipient at this death. */
  gross: number;
  /** Per-asset transfer rows (filtered to this recipient). */
  transfers: DeathTransfer[];
  /** Per-drain-kind allocation. */
  drains: Record<DrainKind, number>;
  /** State inheritance tax (PA/NJ/KY/NE/MD) levied on this recipient's
   *  share. Engine output is informational only — not a drain attribution —
   *  but the display layer subtracts it from net so the heir card matches
   *  what the recipient actually nets after the state collects. */
  inheritanceTax: number;
  /** gross − Σ drains − inheritanceTax. */
  net: number;
}

export interface TrustPassThrough {
  trustId: string;
  trustName: string;
  primaryPercentage: number;
  /** Trust's gross funding (across both deaths) × this recipient's primary
   * percentage. Pro-rata estimate. */
  amount: number;
}

interface DeriveArgs {
  recipient: {
    kind: DeathTransfer["recipientKind"];
    id: string | null;
    name: string;
    relationship?: string | null;
  };
  firstTransfers: DeathTransfer[];
  secondTransfers: DeathTransfer[];
  firstDrainAttributions: DrainAttribution[];
  secondDrainAttributions: DrainAttribution[];
  /** State inheritance tax result for the first/second death event.
   *  Engine emits one entry per recipient keyed by
   *  `${recipientKind}:${recipientId ?? "anon"}` — matches the key built in
   *  inheritance-tax.ts. Undefined when the residence state has no
   *  inheritance tax. */
  firstInheritanceTax?: StateInheritanceTaxResult;
  secondInheritanceTax?: StateInheritanceTaxResult;
  tree: ClientData;
}

const DRAIN_KINDS: DrainKind[] = [
  "federal_estate_tax",
  "state_estate_tax",
  "admin_expenses",
  "debts_paid",
  "ird_tax",
];

function emptyDrains(): Record<DrainKind, number> {
  return {
    federal_estate_tax: 0,
    state_estate_tax: 0,
    admin_expenses: 0,
    debts_paid: 0,
    ird_tax: 0,
  };
}

function buildSlice(
  recipientKind: DeathTransfer["recipientKind"],
  recipientId: string | null,
  transfers: DeathTransfer[],
  attributions: DrainAttribution[],
  inheritanceTaxResult: StateInheritanceTaxResult | undefined,
): DeathSlice {
  const filtered = transfers.filter(
    (t) =>
      t.amount > 0 &&
      t.recipientKind === recipientKind &&
      t.recipientId === recipientId,
  );
  const gross = filtered.reduce((s, t) => s + t.amount, 0);
  const drains = emptyDrains();
  for (const a of attributions) {
    if (a.recipientKind !== recipientKind) continue;
    if (a.recipientId !== recipientId) continue;
    drains[a.drainKind] += a.amount;
  }
  const totalDrains = DRAIN_KINDS.reduce((s, k) => s + drains[k], 0);
  const inheritanceTax = recipientInheritanceTax(
    recipientKind,
    recipientId,
    inheritanceTaxResult,
  );
  return {
    gross,
    transfers: filtered,
    drains,
    inheritanceTax,
    net: gross - totalDrains - inheritanceTax,
  };
}

/** Mirrors the recipient key built in `engine/death-event/inheritance-tax.ts`
 *  (`${recipientKind}:${recipientId ?? "anon"}`). Returns 0 when no matching
 *  per-recipient row exists or the result is missing/inactive. */
function recipientInheritanceTax(
  recipientKind: DeathTransfer["recipientKind"],
  recipientId: string | null,
  result: StateInheritanceTaxResult | undefined,
): number {
  if (!result || result.inactive) return 0;
  const key = `${recipientKind}:${recipientId ?? "anon"}`;
  const row = result.perRecipient.find((r) => r.recipientKey === key);
  return row?.tax ?? 0;
}

function computeTrustPassThrough(
  recipientId: string | null,
  recipientKind: DeathTransfer["recipientKind"],
  firstTransfers: DeathTransfer[],
  secondTransfers: DeathTransfer[],
  tree: ClientData,
): TrustPassThrough[] {
  if (recipientKind !== "family_member" && recipientKind !== "external_beneficiary") {
    return [];
  }
  if (recipientId == null) return [];

  const entityIds = new Set((tree.entities ?? []).map((e) => e.id));
  const trustFunding = new Map<string, number>();
  for (const t of [...firstTransfers, ...secondTransfers]) {
    if (t.amount <= 0) continue;
    if (t.recipientKind !== "entity") continue;
    if (t.recipientId == null || !entityIds.has(t.recipientId)) continue;
    trustFunding.set(t.recipientId, (trustFunding.get(t.recipientId) ?? 0) + t.amount);
  }

  const out: TrustPassThrough[] = [];
  for (const [trustId, funding] of trustFunding.entries()) {
    const ent = (tree.entities ?? []).find((e) => e.id === trustId);
    if (!ent || !ent.beneficiaries) continue;
    const primary = ent.beneficiaries.find(
      (b) =>
        b.tier === "primary" &&
        ((recipientKind === "family_member" && b.familyMemberId === recipientId) ||
          (recipientKind === "external_beneficiary" && b.externalBeneficiaryId === recipientId)),
    );
    if (!primary) continue;
    out.push({
      trustId,
      trustName: ent.name ?? "(unnamed trust)",
      primaryPercentage: primary.percentage,
      amount: (primary.percentage / 100) * funding,
    });
  }
  return out;
}

export function deriveBeneficiaryDetail(args: DeriveArgs): BeneficiaryDetail {
  const fromFirstDeath = buildSlice(
    args.recipient.kind,
    args.recipient.id,
    args.firstTransfers,
    args.firstDrainAttributions,
    args.firstInheritanceTax,
  );
  const fromSecondDeath = buildSlice(
    args.recipient.kind,
    args.recipient.id,
    args.secondTransfers,
    args.secondDrainAttributions,
    args.secondInheritanceTax,
  );
  const inTrust = computeTrustPassThrough(
    args.recipient.id,
    args.recipient.kind,
    args.firstTransfers,
    args.secondTransfers,
    args.tree,
  );
  const trustTotal = inTrust.reduce((s, p) => s + p.amount, 0);
  return {
    fromFirstDeath,
    fromSecondDeath,
    inTrust,
    total: fromFirstDeath.net + fromSecondDeath.net + trustTotal,
  };
}

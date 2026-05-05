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
  /** gross − Σ drains. */
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
  tree: ClientData;
}

const DRAIN_KINDS: DrainKind[] = [
  "federal_estate_tax",
  "state_estate_tax",
  "admin_expenses",
  "debts_paid",
];

function emptyDrains(): Record<DrainKind, number> {
  return {
    federal_estate_tax: 0,
    state_estate_tax: 0,
    admin_expenses: 0,
    debts_paid: 0,
  };
}

function buildSlice(
  recipientKind: DeathTransfer["recipientKind"],
  recipientId: string | null,
  transfers: DeathTransfer[],
  attributions: DrainAttribution[],
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
  return {
    gross,
    transfers: filtered,
    drains,
    net: gross - totalDrains,
  };
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
  );
  const fromSecondDeath = buildSlice(
    args.recipient.kind,
    args.recipient.id,
    args.secondTransfers,
    args.secondDrainAttributions,
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

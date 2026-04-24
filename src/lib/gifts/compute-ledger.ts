import {
  computeGiftTaxTreatment,
  type EntityType,
} from "./compute-tax-treatment";

export type LedgerGift = {
  id: string;
  year: number;
  amount: number;
  grantor: "client" | "spouse" | "joint";
  useCrummeyPowers: boolean;
  recipientEntityId: string | null;
  recipientFamilyMemberId: string | null;
  recipientExternalBeneficiaryId: string | null;
};

export type LedgerContext = {
  entitiesById: Record<string, { isIrrevocable: boolean; entityType: EntityType }>;
  externalsById: Record<string, { kind: "charity" | "individual" }>;
  beneficiaryCountsByEntityId: Record<string, number>;
  annualExclusionByYear: Record<number, number>;
};

export type LedgerEntry = {
  grantor: "client" | "spouse";
  year: number;
  lifetimeUsedThisYear: number;
  cumulativeLifetimeUsed: number;
};

export function computeExemptionLedger(
  gifts: LedgerGift[],
  ctx: LedgerContext,
): LedgerEntry[] {
  const byKey = new Map<string, number>();

  for (const g of gifts) {
    const entity = g.recipientEntityId ? ctx.entitiesById[g.recipientEntityId] : undefined;
    const external = g.recipientExternalBeneficiaryId
      ? ctx.externalsById[g.recipientExternalBeneficiaryId]
      : undefined;
    const annualExclusionAmount = ctx.annualExclusionByYear[g.year] ?? 0;
    const crummeyBeneficiaryCount = g.recipientEntityId
      ? ctx.beneficiaryCountsByEntityId[g.recipientEntityId] ?? 0
      : 0;

    const treatment = computeGiftTaxTreatment(
      {
        amount: g.amount,
        useCrummeyPowers: g.useCrummeyPowers,
        recipientEntityId: g.recipientEntityId,
        recipientFamilyMemberId: g.recipientFamilyMemberId,
        recipientExternalBeneficiaryId: g.recipientExternalBeneficiaryId,
      },
      { entity, external, annualExclusionAmount, crummeyBeneficiaryCount },
    );

    if (treatment.lifetimeUsed === 0) continue;

    const allocations: Array<["client" | "spouse", number]> =
      g.grantor === "joint"
        ? [
            ["client", treatment.lifetimeUsed / 2],
            ["spouse", treatment.lifetimeUsed / 2],
          ]
        : [[g.grantor, treatment.lifetimeUsed]];

    for (const [grantor, amt] of allocations) {
      const key = `${grantor}|${g.year}`;
      byKey.set(key, (byKey.get(key) ?? 0) + amt);
    }
  }

  const entries: LedgerEntry[] = [];
  for (const [key, total] of byKey.entries()) {
    const [grantor, yearStr] = key.split("|");
    entries.push({
      grantor: grantor as "client" | "spouse",
      year: Number(yearStr),
      lifetimeUsedThisYear: total,
      cumulativeLifetimeUsed: 0,
    });
  }
  entries.sort((a, b) =>
    a.grantor === b.grantor ? a.year - b.year : a.grantor < b.grantor ? -1 : 1,
  );
  const running = new Map<"client" | "spouse", number>();
  for (const e of entries) {
    const prev = running.get(e.grantor) ?? 0;
    e.cumulativeLifetimeUsed = prev + e.lifetimeUsedThisYear;
    running.set(e.grantor, e.cumulativeLifetimeUsed);
  }
  return entries;
}

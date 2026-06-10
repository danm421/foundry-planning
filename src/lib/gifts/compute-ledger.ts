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

/** Donee identity for pooling the §2503(b) annual exclusion. AE-eligible cash to
 *  the same donee/grantor in the same year shares one exclusion cap. */
function recipientGroupKey(g: LedgerGift): string {
  if (g.recipientEntityId) return `ent:${g.recipientEntityId}`;
  if (g.recipientFamilyMemberId) return `fm:${g.recipientFamilyMemberId}`;
  if (g.recipientExternalBeneficiaryId)
    return `ext:${g.recipientExternalBeneficiaryId}`;
  return "unmodeled-individual";
}

export function computeExemptionLedger(
  gifts: LedgerGift[],
  ctx: LedgerContext,
): LedgerEntry[] {
  const byKey = new Map<string, number>();

  // §2503(b): exactly ONE annual exclusion per donee per calendar year. Pool
  // AE-eligible cash to the same donee (per grantor + year) so the shared
  // AE × beneficiaryCount cap is applied once. Non-AE-eligible transfers (a
  // trust gift without Crummey, asset transfers with useCrummeyPowers=false,
  // charitable) get no exclusion to pool — they pass through individually so a
  // mixed group never nets a cash exclusion against an asset amount.
  const aggregated = new Map<string, LedgerGift>();
  const passthrough: LedgerGift[] = [];
  for (const g of gifts) {
    const external = g.recipientExternalBeneficiaryId
      ? ctx.externalsById[g.recipientExternalBeneficiaryId]
      : undefined;
    const crummeyBeneficiaryCount = g.recipientEntityId
      ? ctx.beneficiaryCountsByEntityId[g.recipientEntityId] ?? 0
      : 0;
    const aeEligible = g.recipientEntityId
      ? g.useCrummeyPowers && crummeyBeneficiaryCount > 0
      : g.recipientExternalBeneficiaryId
        ? external?.kind !== "charity"
        : true; // family member or unmodeled individual

    if (!aeEligible) {
      passthrough.push(g);
      continue;
    }
    const key = `${g.grantor}|${g.year}|${recipientGroupKey(g)}`;
    const existing = aggregated.get(key);
    if (existing) existing.amount += g.amount;
    else aggregated.set(key, { ...g });
  }

  const toTreat = [...aggregated.values(), ...passthrough];
  for (const g of toTreat) {
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

/**
 * Strategy-attribution helpers for the Projection panel's three impact cards.
 *
 *   - ILIT cards: policy face value at second-death year
 *   - Gifting-trust cards (SLAT, IDGT, irrevocable): gift compounded at growth rate
 *   - Procrastination card: top trust gift's value gap if delayed by N years
 */

import type { ClientData, ProjectionYear } from "@/engine/types";

export interface RankedTrust {
  trustId: string;
  trustName: string;
  trustSubType: string | undefined;
  primaryAmount: number;
  cardKind: "ilit" | "gifting";
}

export function rankTrustsByContribution(
  tree: ClientData,
  withResult: ProjectionYear[],
): RankedTrust[] {
  const ranked: RankedTrust[] = [];
  for (const entity of tree.entities ?? []) {
    if (entity.entityType !== "trust") continue;
    if (entity.isIrrevocable !== true) continue;

    const isIlit =
      entity.trustSubType === "ilit" ||
      hasLifeInsurancePolicy(tree, entity.id);

    if (isIlit) {
      // ILIT classification is exclusive: non-insurance accounts owned by an ILIT
      // (e.g. cash to cover premium shortfalls) are intentionally excluded from
      // primaryAmount. The card is meant to surface the death benefit headline.
      const faceValue = totalIlitFaceValue(tree, entity.id);
      ranked.push({
        trustId: entity.id,
        trustName: entity.name ?? "ILIT",
        trustSubType: entity.trustSubType,
        primaryAmount: faceValue,
        cardKind: "ilit",
      });
    } else {
      const giftAmount = totalGiftsToEntity(tree, entity.id);
      const compoundedValue = compoundedTrustValueAtFinalYear(
        entity.id,
        tree,
        withResult,
      );
      ranked.push({
        trustId: entity.id,
        trustName: entity.name ?? "Trust",
        trustSubType: entity.trustSubType,
        // Floor: if the projection produced $0 (e.g. trust fully distributed by final
        // year, or no ledger entry), fall back to total gifts contributed. We never
        // want $0 on a strategy card if the trust was actually funded.
        primaryAmount: compoundedValue > 0 ? compoundedValue : giftAmount,
        cardKind: "gifting",
      });
    }
  }

  return ranked.sort((a, b) => b.primaryAmount - a.primaryAmount);
}

function hasLifeInsurancePolicy(tree: ClientData, entityId: string): boolean {
  return tree.accounts.some(
    (a) =>
      a.category === "life_insurance" &&
      a.owners.some((o) => o.kind === "entity" && o.entityId === entityId),
  );
}

function totalIlitFaceValue(tree: ClientData, entityId: string): number {
  let total = 0;
  for (const account of tree.accounts) {
    if (account.category !== "life_insurance") continue;
    const slice = account.owners.find(
      (o) => o.kind === "entity" && o.entityId === entityId,
    );
    if (!slice) continue;
    const face = account.lifeInsurance?.faceValue ?? 0;
    total += face * slice.percent;
  }
  return total;
}

function totalGiftsToEntity(tree: ClientData, entityId: string): number {
  return (tree.gifts ?? [])
    .filter((g) => g.recipientEntityId === entityId)
    .reduce((sum, g) => sum + Number(g.amount), 0);
}

function compoundedTrustValueAtFinalYear(
  entityId: string,
  tree: ClientData,
  withResult: ProjectionYear[],
): number {
  const lastYear = withResult[withResult.length - 1];
  if (!lastYear) return 0;
  let total = 0;
  for (const account of tree.accounts) {
    const slice = account.owners.find(
      (o) => o.kind === "entity" && o.entityId === entityId,
    );
    if (!slice) continue;
    const ledger = lastYear.accountLedgers?.[account.id];
    if (!ledger) continue;
    total += (ledger.endingValue ?? 0) * slice.percent;
  }
  return total;
}

export interface TrustCard {
  trustId: string;
  tagLine: string;
  primaryAmount: number;
  narrative: string;
}

export interface ComputeTrustCardArgs {
  ranked: RankedTrust;
  tree: ClientData;
  withResult: ProjectionYear[];
  finalDeathYear: number;
}

export function computeTrustCardData(args: ComputeTrustCardArgs): TrustCard {
  const { ranked, tree, withResult, finalDeathYear } = args;
  if (ranked.cardKind === "ilit") {
    return {
      trustId: ranked.trustId,
      tagLine: `${ranked.trustName.toUpperCase()} · $${formatM(ranked.primaryAmount)} POLICY`,
      primaryAmount: ranked.primaryAmount,
      narrative:
        "Death benefit paid outside the estate. Full face value to heirs tax-free.",
    };
  }

  const giftEvent = (tree.gifts ?? []).find(
    (g) => g.recipientEntityId === ranked.trustId,
  );
  const giftAmount = giftEvent ? Number(giftEvent.amount) : 0;
  const giftYear = giftEvent?.year ?? withResult[0]?.year ?? finalDeathYear;
  const years = finalDeathYear - giftYear;
  const growthRate = inferGrowthRateFromTrust(tree, ranked.trustId);

  const subTypeLabel = (ranked.trustSubType ?? "TRUST").toUpperCase();

  return {
    trustId: ranked.trustId,
    tagLine: `${subTypeLabel} · $${formatM(giftAmount)} GIFT IN ${giftYear}`,
    primaryAmount: ranked.primaryAmount,
    narrative: `Compounded at ${(growthRate * 100).toFixed(1)}% for ${years} years, never taxed.`,
  };
}

function inferGrowthRateFromTrust(tree: ClientData, entityId: string): number {
  let topAccount: { value: number; growthRate: number } | null = null;
  for (const a of tree.accounts) {
    const slice = a.owners.find(
      (o) => o.kind === "entity" && o.entityId === entityId,
    );
    if (!slice) continue;
    const sliceValue = a.value * slice.percent;
    if (!topAccount || sliceValue > topAccount.value) {
      topAccount = { value: sliceValue, growthRate: a.growthRate ?? 0.06 };
    }
  }
  return topAccount?.growthRate ?? 0.06;
}

function formatM(amount: number): string {
  // Drop trailing zeros: 2,400,000 → "2.4M", 5,000,000 → "5M", 9,870,000 → "9.87M",
  // 12,000,000 → "12M". Cap at 2 fractional digits.
  const m = amount / 1_000_000;
  const fixed = m >= 10 ? m.toFixed(0) : m.toFixed(2);
  return parseFloat(fixed).toString() + "M";
}

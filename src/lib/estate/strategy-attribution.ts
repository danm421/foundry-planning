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
        primaryAmount: compoundedValue || giftAmount,
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

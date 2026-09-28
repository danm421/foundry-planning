/**
 * Strategy-attribution helpers for the Projection panel's three impact cards.
 *
 *   - ILIT cards: policy face value at second-death year
 *   - Gifting-trust cards (SLAT, IDGT, irrevocable): gift compounded at growth rate
 *   - Procrastination card: top trust gift's value gap if delayed by N years
 */

import type { Account, ClientData, ProjectionYear } from "@/engine/types";
import { ownersForYearSafe } from "@/lib/estate/owners-or-household";

/** Fallback annual growth rate when an account has no explicit growthRate. */
const DEFAULT_TRUST_GROWTH_RATE = 0.06;

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
      hasLifeInsurancePolicy(tree, entity.id, withResult);

    if (isIlit) {
      // ILIT classification is exclusive: non-insurance accounts owned by an ILIT
      // (e.g. cash to cover premium shortfalls) are intentionally excluded from
      // primaryAmount. The card is meant to surface the death benefit headline.
      const faceValue = totalIlitFaceValue(tree, entity.id, withResult);
      ranked.push({
        trustId: entity.id,
        trustName: entity.name ?? "ILIT",
        trustSubType: entity.trustSubType,
        primaryAmount: faceValue,
        cardKind: "ilit",
      });
    } else {
      const compoundedValue = compoundedTrustValueAtFinalYear(
        entity.id,
        tree,
        withResult,
      );
      ranked.push({
        trustId: entity.id,
        trustName: entity.name ?? "Trust",
        trustSubType: entity.trustSubType,
        primaryAmount: compoundedValue,
        cardKind: "gifting",
      });
    }
  }

  return ranked.sort((a, b) => b.primaryAmount - a.primaryAmount);
}

/**
 * Gift-aware ownership resolver shared by every "does this entity hold a
 * slice of this account, and how much" read below. `account.owners` is only
 * the pre-gift baseline — a trust funded purely by an asset-gift event has
 * no authored entity row at all, so a caller that reads
 * `account.owners.find(...)` directly never sees it. Resolve through the
 * overlay instead.
 */
function entityPctAt(
  account: Account,
  entityId: string,
  lastYear: ProjectionYear | undefined,
  tree: ClientData,
): number {
  const published = lastYear?.accountOwners?.get(account.id);
  // A partitioned pool is already net of every gift up to the death that
  // partitioned it (9C) — re-applying the overlay on top would double-subtract.
  const owners =
    published?.giftsReflectedThrough != null
      ? published.owners
      : ownersForYearSafe(
          account,
          tree.giftEvents ?? [],
          lastYear?.year ?? tree.planSettings.planEndYear,
          tree.planSettings.planStartYear,
        );
  return owners
    .filter((o) => o.kind === "entity" && o.entityId === entityId)
    .reduce((sum, o) => sum + o.percent, 0);
}

function hasLifeInsurancePolicy(
  tree: ClientData,
  entityId: string,
  withResult: ProjectionYear[],
): boolean {
  const lastYear = withResult[withResult.length - 1];
  return tree.accounts.some(
    (a) =>
      a.category === "life_insurance" &&
      entityPctAt(a, entityId, lastYear, tree) > 0,
  );
}

function totalIlitFaceValue(
  tree: ClientData,
  entityId: string,
  withResult: ProjectionYear[],
): number {
  const lastYear = withResult[withResult.length - 1];
  let total = 0;
  for (const account of tree.accounts) {
    if (account.category !== "life_insurance") continue;
    const pct = entityPctAt(account, entityId, lastYear, tree);
    if (pct <= 0) continue;
    const face = account.lifeInsurance?.faceValue ?? 0;
    total += face * pct;
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
  // An entity slice a death partition carved off an account is the entity's
  // own 100% account: its whole ledger is the entity's value.
  for (const [id, rec] of lastYear.accountOwners ?? []) {
    if (rec.sliceOf == null) continue;
    if (!rec.owners.some((o) => o.kind === "entity" && o.entityId === entityId)) continue;
    total += lastYear.accountLedgers?.[id]?.endingValue ?? 0;
  }
  for (const account of tree.accounts) {
    // Year-resolved: a trust funded purely by an asset-gift event has no
    // authored entity row, so selecting off `account.owners` directly would
    // skip it entirely and fall through to a fabricated floor. (Partitioned
    // pools are handled inside the resolver — see `entityPctAt`.)
    const pct = entityPctAt(account, entityId, lastYear, tree);
    if (pct <= 0) continue;
    const ledger = lastYear.accountLedgers?.[account.id];
    if (!ledger) continue;
    // Prefer the engine's locked entity share so household withdrawals on a
    // split-owned account don't drain the trust slice. Falls back to the
    // resolved percent for 100%-trust accounts (where the engine doesn't
    // publish a locked share — pct === 1 makes the math identical).
    const locked = lastYear.entityAccountSharesEoY?.get(entityId)?.get(account.id);
    total += locked ?? (ledger.endingValue ?? 0) * pct;
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
  const yearsRaw = finalDeathYear - giftYear;
  const years = Math.max(1, yearsRaw);
  const growthRate = inferGrowthRateFromTrust(tree, ranked.trustId, withResult);

  const subTypeLabel = (ranked.trustSubType ?? "TRUST").toUpperCase();

  return {
    trustId: ranked.trustId,
    tagLine: `${subTypeLabel} · $${formatM(giftAmount)} GIFT IN ${giftYear}`,
    primaryAmount: ranked.primaryAmount,
    narrative: `Compounded at ${(growthRate * 100).toFixed(1)}% for ${years} years, never taxed.`,
  };
}

function inferGrowthRateFromTrust(
  tree: ClientData,
  entityId: string,
  withResult: ProjectionYear[],
): number {
  const lastYear = withResult[withResult.length - 1];
  let topAccount: { value: number; growthRate: number } | null = null;
  for (const a of tree.accounts) {
    const pct = entityPctAt(a, entityId, lastYear, tree);
    if (pct <= 0) continue;
    const sliceValue = a.value * pct;
    if (!topAccount || sliceValue > topAccount.value) {
      topAccount = { value: sliceValue, growthRate: a.growthRate ?? DEFAULT_TRUST_GROWTH_RATE };
    }
  }
  return topAccount?.growthRate ?? DEFAULT_TRUST_GROWTH_RATE;
}

function formatM(amount: number): string {
  // Sub-$1M: render as K (thousands). $1M+: render as M with up to 2 decimals
  // (no decimal at $10M+). Trailing zeros are dropped (2.40 → 2.4, 5.00 → 5).
  const abs = Math.abs(amount);
  if (abs < 1_000_000) {
    return Math.round(amount / 1_000) + "K";
  }
  const m = amount / 1_000_000;
  const fixed = Math.abs(m) >= 10 ? m.toFixed(0) : m.toFixed(2);
  return parseFloat(fixed).toString() + "M";
}

/**
 * Card data for the "cost of procrastination" comparison: how much terminal-year
 * trust value is lost if the largest gift to that trust is delayed by N years.
 */
export interface ProcrastinationCard {
  /**
   * Signed delta: `delayedTerminalValue - currentTerminalValue`. Always
   * non-positive when compounding is positive (delaying a gift loses growth).
   * UI consumers should `Math.abs()` for display and rely on this being signed
   * to detect the rare zero/positive edge cases (no compounding, or no top trust).
   */
  primaryAmount: number;
  tagLine: string;
  narrative: string;
}

export interface ComputeProcrastinationArgs {
  tree: ClientData;
  withResult: ProjectionYear[];
  /** Pre-computed projection on the delayed-top-gift synthesized variant. */
  delayedResult: ProjectionYear[];
  delayYears: number;
  finalDeathYear: number;
}

export function computeProcrastinationCardData(
  args: ComputeProcrastinationArgs,
): ProcrastinationCard {
  const { tree, withResult, delayedResult, delayYears } = args;
  const ranked = rankTrustsByContribution(tree, withResult);
  const top = ranked.find((r) => r.cardKind === "gifting");
  if (!top) {
    return {
      primaryAmount: 0,
      tagLine: `IF YOU WAIT ${delayYears} YEARS`,
      narrative: "No active gifting trusts to compare against.",
    };
  }

  const currentVal = compoundedTrustValueAtFinalYear(
    top.trustId,
    tree,
    withResult,
  );
  const delayedVal = compoundedTrustValueAtFinalYear(
    top.trustId,
    tree,
    delayedResult,
  );
  const delta = delayedVal - currentVal;

  const giftEvent = (tree.gifts ?? []).find(
    (g) => g.recipientEntityId === top.trustId,
  );
  const giftYear = giftEvent?.year ?? withResult[0]?.year ?? args.finalDeathYear;
  const giftAmount = giftEvent
    ? Number(giftEvent.amount)
    : totalGiftsToEntity(tree, top.trustId);

  return {
    primaryAmount: delta,
    tagLine: `IF YOU WAIT ${delayYears} YEARS`,
    narrative: `Same $${formatM(giftAmount)} gifted in ${giftYear + delayYears} compounds for ${delayYears} fewer years. Cost of procrastination.`,
  };
}

export function synthesizeDelayedTopGift(
  tree: ClientData,
  delayYears: number,
): ClientData {
  const irrevocableTrustIds = new Set(
    (tree.entities ?? [])
      .filter((e) => e.entityType === "trust" && e.isIrrevocable === true)
      .map((e) => e.id),
  );

  const trustGifts = (tree.gifts ?? []).filter(
    (g) => g.recipientEntityId && irrevocableTrustIds.has(g.recipientEntityId),
  );
  if (trustGifts.length === 0) return tree;

  const topGift = [...trustGifts].sort(
    (a, b) => Number(b.amount) - Number(a.amount),
  )[0];

  return {
    ...tree,
    gifts: (tree.gifts ?? []).map((g) =>
      g.id === topGift.id ? { ...g, year: g.year + delayYears } : g,
    ),
  };
}

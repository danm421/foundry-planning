import type { EntitySummary, Gift, GiftEvent } from "./types";
import { applyUnifiedRateSchedule, beaForYear } from "@/lib/tax/estate";
import {
  toCanonicalGifts,
  treatCanonicalGift,
  type CanonicalGift,
} from "@/lib/gifts/normalize-gifts";

export interface GrantorYearState {
  /** Taxable gifts this year only (after annual exclusion + charitable). */
  taxableGiftsThisYear: number;
  /** Running total including priorTaxableGifts seed. */
  cumulativeTaxableGifts: number;
  creditUsed: number;
  /** §2502 marginal current-year tax. 0 until cumulative > BEA(year). */
  giftTaxThisYear: number;
  cumulativeGiftTax: number;
}

export interface GiftLedgerYear {
  year: number;
  giftsGiven: number;
  taxableGiftsGiven: number;
  perGrantor: {
    client: GrantorYearState;
    spouse?: GrantorYearState;
  };
  totalGiftTax: number;
}

export interface GiftLedgerInput {
  planStartYear: number;
  planEndYear: number;
  hasSpouse: boolean;
  priorTaxableGifts: { client: number; spouse: number };
  gifts: Gift[];
  giftEvents: GiftEvent[];
  /** All modeled entities — supplies trust isIrrevocable/entityType + Crummey
   *  beneficiary counts to the unified gift-tax treatment. */
  entities: EntitySummary[];
  externalBeneficiaries?: Array<{ id: string; kind: "charity" | "individual" }>;
  annualExclusionsByYear: Record<number, number>;
  taxInflationRate: number;
  lifetimeExemptionCap?: number | null;
  accountValueAtYear: (accountId: string, year: number) => number;
  /** Resolver for business-entity value at a given year. Required for
   *  `business_interest` GiftEvents; optional so callers that don't yet
   *  surface entity values can omit it (defaults to a zero resolver). */
  entityValueAtYear?: (entityId: string, year: number) => number;
}

type Grantor = "client" | "spouse";

function emptyState(): GrantorYearState {
  return {
    taxableGiftsThisYear: 0,
    cumulativeTaxableGifts: 0,
    creditUsed: 0,
    giftTaxThisYear: 0,
    cumulativeGiftTax: 0,
  };
}

export function computeGiftLedger(input: GiftLedgerInput): GiftLedgerYear[] {
  const result: GiftLedgerYear[] = [];

  const canonical = toCanonicalGifts(input.gifts, input.giftEvents, {
    entities: input.entities,
    externalBeneficiaries: input.externalBeneficiaries,
    accountValueAtYear: input.accountValueAtYear,
    entityValueAtYear: input.entityValueAtYear,
  });

  // Per-year gross gift total (pre-exclusion). Summing canonical amounts
  // reproduces the gross — joint halves sum back to the whole, and the
  // normalizer already applies the one-time-cash dedup the ledger needs — so
  // there is no separate gross-summing pass to keep in lockstep.
  const grossByYear = new Map<number, number>();
  for (const cg of canonical) {
    grossByYear.set(cg.year, (grossByYear.get(cg.year) ?? 0) + cg.amount);
  }

  let prevClient: GrantorYearState = {
    ...emptyState(),
    cumulativeTaxableGifts: input.priorTaxableGifts.client,
    creditUsed: applyUnifiedRateSchedule(input.priorTaxableGifts.client),
  };
  let prevSpouse: GrantorYearState | undefined = input.hasSpouse
    ? {
        ...emptyState(),
        cumulativeTaxableGifts: input.priorTaxableGifts.spouse,
        creditUsed: applyUnifiedRateSchedule(input.priorTaxableGifts.spouse),
      }
    : undefined;

  for (let year = input.planStartYear; year <= input.planEndYear; year++) {
    const client = stepGrantor("client", year, prevClient, input, canonical);
    const spouse = input.hasSpouse && prevSpouse
      ? stepGrantor("spouse", year, prevSpouse, input, canonical)
      : undefined;

    const taxableGiftsGiven = client.taxableGiftsThisYear + (spouse?.taxableGiftsThisYear ?? 0);
    const totalGiftTax = client.giftTaxThisYear + (spouse?.giftTaxThisYear ?? 0);

    result.push({
      year,
      giftsGiven: grossByYear.get(year) ?? 0,
      taxableGiftsGiven,
      perGrantor: { client, ...(spouse ? { spouse } : {}) },
      totalGiftTax,
    });

    prevClient = client;
    if (spouse) prevSpouse = spouse;
  }

  return result;
}

/**
 * §2503(b): exactly ONE annual exclusion per donee per calendar year (for a
 * Crummey trust, AE × beneficiaryCount per year). A canonical gift is
 * AE-eligible — i.e. `treatCanonicalGift` would apply an annual exclusion — for
 * cash to a natural person (family member / external individual / unmodeled
 * individual) and for Crummey-eligible cash to a trust. Asset and
 * business-interest transfers (forced `useCrummeyPowers: false` in
 * normalize-gifts) and charitable gifts are NOT AE-eligible.
 */
function isAnnualExclusionEligible(cg: CanonicalGift): boolean {
  if (cg.recipientEntityId) {
    return cg.useCrummeyPowers && cg.crummeyBeneficiaryCount > 0;
  }
  if (cg.recipientExternalBeneficiaryId) {
    return cg.external?.kind !== "charity";
  }
  // Family member or unmodeled individual — both draw a single AE.
  return true;
}

/** Donee identity for pooling the §2503(b) exclusion. AE-eligible cash to the
 *  same donee in the same year shares one exclusion cap. */
function recipientGroupKey(cg: CanonicalGift): string {
  if (cg.recipientEntityId) return `ent:${cg.recipientEntityId}`;
  if (cg.recipientFamilyMemberId) return `fm:${cg.recipientFamilyMemberId}`;
  if (cg.recipientExternalBeneficiaryId)
    return `ext:${cg.recipientExternalBeneficiaryId}`;
  return "unmodeled-individual";
}

function stepGrantor(
  grantor: Grantor,
  year: number,
  prev: GrantorYearState,
  input: GiftLedgerInput,
  canonical: CanonicalGift[],
): GrantorYearState {
  const exclusion = input.annualExclusionsByYear[year] ?? 0;
  const thisYears = canonical.filter(
    (cg) => cg.grantor === grantor && cg.year === year,
  );

  // §2503(b): aggregate AE-eligible transfers by donee so each donee claims at
  // most ONE annual exclusion (AE × beneficiaryCount) per year, then treat the
  // pooled amount once. Per-group context (entity/Crummey count, external kind)
  // is identical within a group, so the first gift's canonical form represents
  // the group; only its `amount` differs. Non-AE-eligible transfers (asset /
  // business / charitable) get no exclusion to pool — pass each through
  // unchanged so a mixed group to the same trust never nets a cash exclusion
  // against an asset amount.
  const aggregated = new Map<string, CanonicalGift>();
  let taxableGiftsThisYear = 0;
  for (const cg of thisYears) {
    if (!isAnnualExclusionEligible(cg)) {
      taxableGiftsThisYear += treatCanonicalGift(cg, exclusion).lifetimeUsed;
      continue;
    }
    const key = recipientGroupKey(cg);
    const existing = aggregated.get(key);
    if (existing) {
      existing.amount += cg.amount;
    } else {
      aggregated.set(key, { ...cg });
    }
  }
  for (const group of aggregated.values()) {
    taxableGiftsThisYear += treatCanonicalGift(group, exclusion).lifetimeUsed;
  }

  const cumulativeBefore = prev.cumulativeTaxableGifts;
  const cumulativeAfter = cumulativeBefore + taxableGiftsThisYear;

  const tentativeTaxOnAfter = applyUnifiedRateSchedule(cumulativeAfter);
  const tentativeTaxOnBefore = applyUnifiedRateSchedule(cumulativeBefore);
  const currentYearTentTax = tentativeTaxOnAfter - tentativeTaxOnBefore;

  const beaCredit = applyUnifiedRateSchedule(beaForYear(year, input.taxInflationRate, input.lifetimeExemptionCap));
  const remainingCredit = Math.max(0, beaCredit - tentativeTaxOnBefore);
  const giftTaxThisYear = Math.max(0, currentYearTentTax - remainingCredit);

  return {
    taxableGiftsThisYear,
    cumulativeTaxableGifts: cumulativeAfter,
    creditUsed: tentativeTaxOnAfter,
    giftTaxThisYear,
    cumulativeGiftTax: prev.cumulativeGiftTax + giftTaxThisYear,
  };
}

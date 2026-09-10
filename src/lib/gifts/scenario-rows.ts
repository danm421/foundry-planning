// Scenario-aware row builders for the Details → Profile view.
//
// The trust and gift lists on this page used to read the `entities` / `gifts`
// tables directly. Neither table is scenario-scoped, so a trust or gift created
// in the solver and saved to a scenario projected correctly but was invisible
// here — the Changes panel listed it while the section beside it said "No
// trusts yet". These builders re-source both lists from the same overlay the
// projection uses: entities from the effective tree, gifts from the scenario's
// `gift` changes.

import type { EntitySummary } from "@/engine/types";
import type { ScenarioChange } from "@/engine/scenario/types";
import { partitionGiftChanges } from "@/lib/scenario/apply-gift-overlays";
import type { EstateFlowGift, GiftRecipientRef } from "@/lib/estate/estate-flow-gifts";
import type { Entity, Gift, GiftSeriesLite, NamePctRow } from "@/components/family-view";

/** The three `entities`-row columns the engine's `EntitySummary` doesn't carry.
 *  Absent for a trust that exists only as a scenario change. */
export interface EntityRowExtras {
  notes: string | null;
  owner: "client" | "spouse" | "joint" | null;
  beneficiaries: NamePctRow[] | null;
}

/** Effective-tree entity → the row shape the Profile's trust/business tables and
 *  the entity dialog render. */
export function entitySummaryToRow(
  e: EntitySummary,
  extras?: EntityRowExtras,
): Entity {
  return {
    id: e.id,
    name: e.name ?? "",
    entityType: e.entityType ?? "trust",
    notes: extras?.notes ?? null,
    includeInPortfolio: e.includeInPortfolio,
    isGrantor: e.isGrantor,
    grantorStatusEndYear: e.grantorStatusEndYear ?? null,
    value: String(e.value ?? 0),
    basis: String(e.basis ?? 0),
    owners: e.owners ?? [],
    owner: extras?.owner ?? null,
    grantor: e.grantor ?? null,
    beneficiaries: extras?.beneficiaries ?? null,
    trustSubType: e.trustSubType ?? null,
    isIrrevocable: e.isIrrevocable ?? null,
    trustee: e.trustee ?? null,
    trustEnds: e.trustEnds ?? null,
    distributionMode: e.distributionMode ?? null,
    distributionAmount: e.distributionAmount ?? null,
    distributionPercent: e.distributionPercent ?? null,
    taxTreatment: e.taxTreatment,
    distributionPolicyPercent: e.distributionPolicyPercent ?? null,
    flowMode: e.flowMode,
    valueGrowthRate: e.valueGrowthRate ?? null,
  };
}

function recipientColumns(r: GiftRecipientRef) {
  return {
    recipientEntityId: r.kind === "entity" ? r.id : null,
    recipientFamilyMemberId: r.kind === "family_member" ? r.id : null,
    recipientExternalBeneficiaryId: r.kind === "external_beneficiary" ? r.id : null,
  };
}

/** One-time gift draft → `gifts`-row shape. Series drafts return null; they go
 *  through `giftDraftToSeriesRow` instead. */
export function giftDraftToRow(g: EstateFlowGift): Gift | null {
  if (g.kind === "series") return null;
  const common = {
    id: g.id,
    year: g.year,
    grantor: g.grantor,
    ...recipientColumns(g.recipient),
    valuationDiscount: g.valuationDiscount ?? null,
    notes: null,
  };
  // Asset gifts carry no Crummey concept, and their `amount` column holds the
  // advisor's manual valuation override (null = value it from the account).
  return g.kind === "asset-once"
    ? {
        ...common,
        amount: g.amountOverride ?? null,
        accountId: g.accountId,
        percent: g.percent,
        useCrummeyPowers: false,
      }
    : {
        ...common,
        amount: g.amount,
        accountId: null,
        percent: null,
        useCrummeyPowers: g.crummey,
      };
}

/** Series gift draft → `gift_series`-row shape. Non-series drafts return null. */
export function giftDraftToSeriesRow(g: EstateFlowGift): GiftSeriesLite | null {
  if (g.kind !== "series") return null;
  return {
    id: g.id,
    grantor: g.grantor,
    ...recipientColumns(g.recipient),
    startYear: g.startYear,
    endYear: g.endYear,
    annualAmount: g.annualAmount,
    amountMode: g.amountMode,
    inflationAdjust: g.inflationAdjust,
    valuationDiscount: g.valuationDiscount ?? null,
    useCrummeyPowers: g.crummey,
  };
}

/**
 * Overlay a scenario's `gift` changes onto the page's base-plan gift and
 * gift-series rows. Mirrors `overlayGiftDrafts` — every targeted id is stripped
 * from both lists, then each `add` payload is appended to whichever list its
 * draft kind belongs to.
 *
 * Base rows are kept in their DB shape rather than round-tripped through a
 * draft: `giftRowToDraft` drops business-interest gifts, which this page does
 * render.
 */
export function overlayScenarioGiftRows(
  baseGifts: Gift[],
  baseSeries: GiftSeriesLite[],
  giftChanges: ScenarioChange[],
): { gifts: Gift[]; series: GiftSeriesLite[] } {
  if (giftChanges.length === 0) return { gifts: baseGifts, series: baseSeries };
  const { targeted, adds } = partitionGiftChanges(giftChanges);
  return {
    gifts: [
      ...baseGifts.filter((g) => !targeted.has(g.id)),
      ...adds.map(giftDraftToRow).filter((g): g is Gift => g !== null),
    ],
    series: [
      ...baseSeries.filter((s) => !targeted.has(s.id)),
      ...adds.map(giftDraftToSeriesRow).filter((s): s is GiftSeriesLite => s !== null),
    ],
  };
}

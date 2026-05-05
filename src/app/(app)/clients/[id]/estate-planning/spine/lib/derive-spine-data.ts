/**
 * derive-spine-data.ts
 *
 * Pure transform: (ClientData + ProjectionResult) → SpineData discriminated union.
 * No React, no DB, no Next.js — safe for vitest and future PDF consumption.
 *
 * Three variants:
 *   "two-grantor"    — both spouses alive at plan start; first & second death events
 *                      both land within the projection window.
 *   "single-grantor" — only one principal (widowed or single filer); one death event.
 *   "historical"     — no death events found in the projection window; unable to
 *                      render a meaningful spine.
 */

import {
  computeFirstDeathYear,
  computeFinalDeathYear,
  identifyDeceased,
  identifyFinalDeceased,
} from "@/engine/death-event";
import { computeGrossEstate } from "@/engine/death-event/estate-tax";
import type {
  ClientData,
  DrainAttribution,
  EntitySummary,
  EstateTaxResult,
  DeathTransfer,
  HypotheticalEstateTax,
  HypotheticalEstateTaxOrdering,
} from "@/engine/types";
import type { ProjectionResult } from "@/engine";
import { treeAsOfYear, type BalanceMode } from "../../lib/tree-as-of-year";
import { resolveRecipientLabel } from "@/lib/estate/recipient-label";
import type { AsOfValue } from "@/components/report-controls/as-of-dropdown";

// ── Output types ──────────────────────────────────────────────────────────────

export interface BeneficiaryCard {
  name: string;
  relationship: string | null;
  value: number;
  isTrustRemainder: boolean;
  pctOfHeirs: number;
}

export interface StageTaxBreakdown {
  grossEstate: number;
  maritalDeduction: number;
  charitableDeduction: number;
  estateAdminExpenses: number;
  taxableEstate: number;
  applicableExclusion: number;
  federalEstateTax: number;
  stateEstateTax: number;
}

export type SpineData =
  | {
      kind: "two-grantor";
      today: { year: number };
      pair: {
        client: { name: string; netWorth: number };
        spouse: { name: string; netWorth: number };
      };
      firstDeath: {
        year: number;
        deceasedName: string;
        tax: number;
        toSpouse: number;
        /** Outflows to trust entities at this death. Excluded from toHeirs. */
        toTrusts: number;
        /** Non-spouse, non-trust outflows at first death (direct bequests to
         * heirs, charity). Zero for the typical full-marital case. */
        toHeirs: number;
        drainAttributions: DrainAttribution[];
        transfers: DeathTransfer[];
        taxBreakdown: StageTaxBreakdown;
      };
      combined: { value: number };
      secondDeath: {
        year: number;
        deceasedName: string;
        tax: number;
        toTrusts: number;
        toHeirs: number;
        drainAttributions: DrainAttribution[];
        transfers: DeathTransfer[];
        taxBreakdown: StageTaxBreakdown;
      };
      beneficiaries: BeneficiaryCard[];
      /** Entities (trusts) configured on the household — passed through so
       * expansion components can resolve trust names and subtypes. */
      entities: EntitySummary[];
      totals: { taxesAndExpenses: number; toHeirs: number };
    }
  | {
      kind: "single-grantor";
      survivorName: string;
      today: { year: number };
      death: {
        year: number;
        tax: number;
        toTrusts: number;
        toHeirs: number;
        drainAttributions: DrainAttribution[];
        transfers: DeathTransfer[];
        taxBreakdown: StageTaxBreakdown;
      };
      beneficiaries: BeneficiaryCard[];
      entities: EntitySummary[];
      totals: { taxesAndExpenses: number; toHeirs: number };
    }
  | { kind: "historical"; message: string };

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Sum `amount` for non-spouse, non-trust-entity transfers (direct bequests
 *  to heirs/charity/system_default). Trust-entity transfers are split out
 *  via `sumToTrusts` and shown under their own band. */
function sumToHeirs(transfers: DeathTransfer[], tree: ClientData): number {
  const entityIds = new Set((tree.entities ?? []).map((e) => e.id));
  return transfers.reduce((acc, t) => {
    if (t.amount <= 0) return acc;
    if (t.recipientKind === "spouse") return acc;
    if (t.recipientKind === "entity" && t.recipientId && entityIds.has(t.recipientId)) {
      return acc;
    }
    return acc + t.amount;
  }, 0);
}

/** Sum `amount` for transfers routed to trust entities (recipientKind=entity
 *  with a recipientId in `tree.entities`). */
function sumToTrusts(transfers: DeathTransfer[], tree: ClientData): number {
  const entityIds = new Set((tree.entities ?? []).map((e) => e.id));
  return transfers.reduce((acc, t) => {
    if (t.amount <= 0) return acc;
    if (t.recipientKind !== "entity") return acc;
    if (t.recipientId == null || !entityIds.has(t.recipientId)) return acc;
    return acc + t.amount;
  }, 0);
}

/** Pull the eight numeric fields the TaxCalcWalk expansion renders out of an
 *  EstateTaxResult. Pure projection; no rounding. */
function extractTaxBreakdown(e: EstateTaxResult): StageTaxBreakdown {
  return {
    grossEstate: e.grossEstate,
    maritalDeduction: e.maritalDeduction,
    charitableDeduction: e.charitableDeduction,
    estateAdminExpenses: e.estateAdminExpenses,
    taxableEstate: e.taxableEstate,
    applicableExclusion: e.applicableExclusion,
    federalEstateTax: e.federalEstateTax,
    stateEstateTax: e.stateEstateTax,
  };
}

function zeroTaxBreakdown(): StageTaxBreakdown {
  return {
    grossEstate: 0,
    maritalDeduction: 0,
    charitableDeduction: 0,
    estateAdminExpenses: 0,
    taxableEstate: 0,
    applicableExclusion: 0,
    federalEstateTax: 0,
    stateEstateTax: 0,
  };
}

/**
 * Group transfers by (recipientKind, recipientId) and produce BeneficiaryCards.
 * Excludes spouse transfers (those are the marital deduction, shown separately).
 */
function buildBeneficiaryCards(
  transfers: DeathTransfer[],
  tree: ClientData,
  totalToHeirs: number,
): BeneficiaryCard[] {
  type Key = string;
  const grouped = new Map<
    Key,
    { name: string; relationship: string | null; value: number; isTrustRemainder: boolean }
  >();

  const famById = new Map(
    (tree.familyMembers ?? []).map((fm) => [fm.id, fm]),
  );

  for (const t of transfers) {
    if (t.recipientKind === "spouse") continue;
    if (t.amount <= 0) continue;
    // Only heirs: family_member, entity, external_beneficiary, system_default
    if (
      t.recipientKind !== "family_member" &&
      t.recipientKind !== "entity" &&
      t.recipientKind !== "external_beneficiary" &&
      t.recipientKind !== "system_default"
    )
      continue;
    // Defensive: skip family_members whose role is "client"/"spouse" — they're
    // grantors, not heirs. The engine's applyFallback excludes these by role,
    // but other engine paths could still emit a self-transfer with stale data.
    if (t.recipientKind === "family_member" && t.recipientId) {
      const fm = famById.get(t.recipientId);
      if (fm && (fm.role === "client" || fm.role === "spouse")) continue;
    }

    const key: Key = `${t.recipientKind}|${t.recipientId ?? ""}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.value += t.amount;
    } else {
      const resolved = resolveRecipientLabel(t, tree);
      grouped.set(key, {
        name: resolved.name,
        relationship: resolved.relationship,
        value: t.amount,
        isTrustRemainder: resolved.isTrustRemainder,
      });
    }
  }

  const cards: BeneficiaryCard[] = [];
  for (const card of grouped.values()) {
    cards.push({
      ...card,
      pctOfHeirs: totalToHeirs > 0 ? card.value / totalToHeirs : 0,
    });
  }

  return cards;
}

/**
 * Compute one principal's gross estate at `year` using the same
 * year-overlay convention as the In Estate / Out of Estate columns
 * (`treeAsOfYear`): BoY balances at planStartYear (advisor-entered values,
 * matching the Balance Sheet's Today view) and EoY balances for future
 * years. Used by the PairRow under the TODAY/AS-OF tick.
 *
 * Returns 0 when the requested future year isn't in the projection.
 */
function computeGrossEstateAtYear(
  tree: ClientData,
  withResult: ProjectionResult,
  principal: "client" | "spouse",
  year: number,
  mode: BalanceMode,
): number {
  const planStartYear = tree.planSettings.planStartYear;
  if (year > planStartYear && !withResult.years.find((y) => y.year === year)) {
    return 0;
  }

  const overlaid = treeAsOfYear(tree, withResult, year, mode);

  const principalFm = (overlaid.familyMembers ?? []).find((fm) => fm.role === principal);
  const principalFmId = principalFm?.id ?? null;
  const otherRole = principal === "client" ? "spouse" : "client";
  const otherFm = (overlaid.familyMembers ?? []).find((fm) => fm.role === otherRole);
  const otherFmId = otherFm?.id ?? null;

  const accountBalances: Record<string, number> = {};
  for (const a of overlaid.accounts) accountBalances[a.id] = a.value;

  const result = computeGrossEstate({
    deceased: principal,
    deathOrder: 1,
    accounts: overlaid.accounts,
    accountBalances,
    liabilities: overlaid.liabilities,
    entities: overlaid.entities ?? [],
    deceasedFmId: principalFmId,
    survivorFmId: otherFmId,
  });
  return result.total;
}

// ── Death-stage source resolver ───────────────────────────────────────────────

/**
 * Drives the death-stage projections (first/second death year, taxes, marital
 * deduction, transfers, combined estate). Three modes:
 *
 *  - "real"         — read from the projection's actual `firstDeathEvent` /
 *                     `secondDeathEvent` (life-expectancy years). Used for
 *                     "split", or when the user picks a year that *is* a real
 *                     death year (the "First Death" / "Last Death" pills).
 *  - "hypothetical" — read from `todayHypotheticalEstateTax` ("today") or
 *                     `years[year].hypotheticalEstateTax` (any other numeric
 *                     selection). Both deaths collapse to the same year.
 *  - "none"         — no data available (projection has no death events).
 */
type DeathStageSource =
  | {
      kind: "real";
      firstEvent: EstateTaxResult | undefined;
      secondEvent: EstateTaxResult | undefined;
      firstYear: number;
      secondYear: number;
      firstTransfers: DeathTransfer[];
      secondTransfers: DeathTransfer[];
      combinedValue: number;
    }
  | {
      kind: "hypothetical";
      collapsedYear: number;
      branch: HypotheticalEstateTaxOrdering;
    }
  | { kind: "none" };

function resolveDeathStageSource(
  withResult: ProjectionResult,
  asOf: AsOfValue,
  firstDeathYear: number | null,
  finalDeathYear: number | null,
): DeathStageSource {
  const realFirstYear = withResult.firstDeathEvent?.year ?? firstDeathYear ?? null;
  const realSecondYear = withResult.secondDeathEvent?.year ?? finalDeathYear ?? null;

  // Real-event path: "split", or numeric selection that matches a real death
  // year (so the "First Death" / "Last Death" pills land here too).
  const isRealYearSelection =
    typeof asOf === "number" &&
    (asOf === realFirstYear || asOf === realSecondYear);

  if (asOf === "split" || isRealYearSelection) {
    if (realFirstYear == null && realSecondYear == null) return { kind: "none" };
    const firstYearRow =
      realFirstYear != null
        ? withResult.years.find((y) => y.year === realFirstYear)
        : undefined;
    const secondYearRow =
      realSecondYear != null
        ? withResult.years.find((y) => y.year === realSecondYear)
        : undefined;
    const firstYearIndex =
      realFirstYear != null
        ? withResult.years.findIndex((y) => y.year === realFirstYear)
        : -1;
    // Combined estate: survivor's portfolio total the year *after* first death
    // (post-marital-deduction). Mirrors the prior inline computation.
    const combinedValue =
      firstYearIndex >= 0
        ? (withResult.years[firstYearIndex + 1]?.portfolioAssets.total ?? 0)
        : 0;
    return {
      kind: "real",
      firstEvent: withResult.firstDeathEvent,
      secondEvent: withResult.secondDeathEvent,
      firstYear: realFirstYear ?? 0,
      secondYear: realSecondYear ?? 0,
      firstTransfers: (firstYearRow?.deathTransfers ?? []).filter(
        (t) => t.deathOrder === 1,
      ),
      secondTransfers: (secondYearRow?.deathTransfers ?? []).filter(
        (t) => t.deathOrder === 2,
      ),
      combinedValue,
    };
  }

  // Hypothetical path: "today" or any non-real-death numeric selection.
  let ht: HypotheticalEstateTax | undefined;
  if (asOf === "today") {
    ht = withResult.todayHypotheticalEstateTax;
  } else if (typeof asOf === "number") {
    ht = withResult.years.find((y) => y.year === asOf)?.hypotheticalEstateTax;
  }
  if (!ht) return { kind: "none" };
  return { kind: "hypothetical", collapsedYear: ht.year, branch: ht.primaryFirst };
}

// ── Main export ───────────────────────────────────────────────────────────────

export function deriveSpineData(args: {
  tree: ClientData;
  withResult: ProjectionResult;
  /** Year used for the PairRow + TODAY tick at the top of the spine. Defaults
   * to planStartYear (today). When the canvas's as-of dropdown is set to a
   * future year (e.g. retirement), the column values reflect that year, and
   * the spine anchors its net-worth snapshot to the same year for visual
   * consistency. */
  pairRowYear?: number;
  /** Balance mode for the PairRow. "boy" reproduces the Balance Sheet's
   * Today view (advisor-entered balances at planStart); "eoy" reads the
   * year's projected end-of-year balances. Defaults to "boy" so the test
   * suite's omitted-arg call sites preserve the original anchor behavior. */
  pairRowMode?: BalanceMode;
  /** Drives the death-stage projections. See `resolveDeathStageSource`. */
  asOf: AsOfValue;
}): SpineData {
  const { tree, withResult, asOf } = args;
  const { client, planSettings } = tree;
  const { planStartYear, planEndYear } = planSettings;
  const anchorYear = args.pairRowYear ?? planStartYear;
  const anchorMode: BalanceMode = args.pairRowMode ?? "boy";

  const firstDeathYear = computeFirstDeathYear(client, planStartYear, planEndYear);
  const finalDeathYear = computeFinalDeathYear(client, planStartYear, planEndYear);

  // ── "historical": no death events in the window ─────────────────────────────
  if (firstDeathYear === null && finalDeathYear === null) {
    return {
      kind: "historical",
      message:
        "No death events fall within the plan window. Life expectancy data may be missing.",
    };
  }

  // Single-grantor: no spouse OR only one death event falls in-window
  // Condition: either no spouseDob, or firstDeathYear is null (one is pre-plan)
  // but finalDeathYear is set (the surviving principal still has a death in window)
  const hasSpouse = !!client.spouseDob;

  // ── "two-grantor" ─────────────────────────────────────────────────────────
  if (hasSpouse && firstDeathYear !== null && finalDeathYear !== null && firstDeathYear !== finalDeathYear) {
    const firstDeceasedRole = identifyDeceased(client, firstDeathYear);
    const finalDeceasedRole = identifyFinalDeceased(client, firstDeceasedRole);

    // Resolve names via FamilyMember list (fallback to ClientInfo fields)
    const firstDeceasedFm = (tree.familyMembers ?? []).find(
      (fm) => fm.role === firstDeceasedRole,
    );
    const finalDeceasedFm = (tree.familyMembers ?? []).find(
      (fm) => fm.role === finalDeceasedRole,
    );

    const firstDeceasedName =
      firstDeceasedFm?.firstName ??
      (firstDeceasedRole === "client" ? client.firstName : client.spouseName ?? "Spouse");
    const finalDeceasedName =
      finalDeceasedFm?.firstName ??
      (finalDeceasedRole === "client" ? client.firstName : client.spouseName ?? "Spouse");

    // Net worth at the anchor year (planStartYear by default; the canvas
    // overrides this when the as-of dropdown picks a future year). Computed
    // from the projection's accountLedgers so it stays in sync with the
    // left/right columns, which read the same year's overlaid balances.
    const clientNetWorth = computeGrossEstateAtYear(tree, withResult, "client", anchorYear, anchorMode);
    const spouseNetWorth = computeGrossEstateAtYear(tree, withResult, "spouse", anchorYear, anchorMode);

    const source = resolveDeathStageSource(withResult, asOf, firstDeathYear, finalDeathYear);

    let firstStageYear: number;
    let secondStageYear: number;
    let firstTax: number;
    let firstToSpouse: number;
    let firstDeathTransfers: DeathTransfer[];
    let firstAttributions: DrainAttribution[];
    let firstBreakdown: StageTaxBreakdown;
    let secondTax: number;
    let secondDeathTransfers: DeathTransfer[];
    let secondAttributions: DrainAttribution[];
    let secondBreakdown: StageTaxBreakdown;
    let combinedValue: number;

    if (source.kind === "hypothetical") {
      firstStageYear = source.collapsedYear;
      secondStageYear = source.collapsedYear;
      firstTax = source.branch.firstDeath.totalTaxesAndExpenses;
      firstToSpouse = source.branch.firstDeath.maritalDeduction;
      firstDeathTransfers = source.branch.firstDeathTransfers;
      firstAttributions = source.branch.firstDeath.drainAttributions ?? [];
      firstBreakdown = extractTaxBreakdown(source.branch.firstDeath);
      secondTax = source.branch.finalDeath?.totalTaxesAndExpenses ?? 0;
      secondDeathTransfers = source.branch.finalDeathTransfers ?? [];
      secondAttributions = source.branch.finalDeath?.drainAttributions ?? [];
      secondBreakdown = source.branch.finalDeath
        ? extractTaxBreakdown(source.branch.finalDeath)
        : zeroTaxBreakdown();
      combinedValue = source.branch.finalDeath?.grossEstate ?? 0;
    } else if (source.kind === "real") {
      firstStageYear = source.firstYear;
      secondStageYear = source.secondYear;
      firstTax = source.firstEvent?.totalTaxesAndExpenses ?? 0;
      firstToSpouse = source.firstEvent?.maritalDeduction ?? 0;
      firstDeathTransfers = source.firstTransfers;
      firstAttributions = source.firstEvent?.drainAttributions ?? [];
      firstBreakdown = source.firstEvent
        ? extractTaxBreakdown(source.firstEvent)
        : zeroTaxBreakdown();
      secondTax = source.secondEvent?.totalTaxesAndExpenses ?? 0;
      secondDeathTransfers = source.secondTransfers;
      secondAttributions = source.secondEvent?.drainAttributions ?? [];
      secondBreakdown = source.secondEvent
        ? extractTaxBreakdown(source.secondEvent)
        : zeroTaxBreakdown();
      combinedValue = source.combinedValue;
    } else {
      firstStageYear = firstDeathYear;
      secondStageYear = finalDeathYear;
      firstTax = 0;
      firstToSpouse = 0;
      firstDeathTransfers = [];
      firstAttributions = [];
      firstBreakdown = zeroTaxBreakdown();
      secondTax = 0;
      secondDeathTransfers = [];
      secondAttributions = [];
      secondBreakdown = zeroTaxBreakdown();
      combinedValue = 0;
    }

    const firstToHeirs = sumToHeirs(firstDeathTransfers, tree);
    const firstToTrusts = sumToTrusts(firstDeathTransfers, tree);
    const secondToHeirs = sumToHeirs(secondDeathTransfers, tree);
    const secondToTrusts = sumToTrusts(secondDeathTransfers, tree);

    // Heir cards aggregate non-spouse transfers across BOTH deaths and trust
    // distributions, grouped by recipient. A child receiving from Cooper at
    // first death AND from Susan at second death sees a single combined card.
    const totalToHeirs = firstToHeirs + secondToHeirs;
    const beneficiaries = buildBeneficiaryCards(
      [...firstDeathTransfers, ...secondDeathTransfers],
      tree,
      totalToHeirs,
    );

    const totalTaxesAndExpenses = firstTax + secondTax;

    const spouseFm = (tree.familyMembers ?? []).find((fm) => fm.role === "spouse");
    const spouseDisplayName =
      spouseFm?.firstName ?? client.spouseName ?? "Spouse";

    return {
      kind: "two-grantor",
      today: { year: anchorYear },
      pair: {
        client: { name: client.firstName, netWorth: clientNetWorth },
        spouse: { name: spouseDisplayName, netWorth: spouseNetWorth },
      },
      firstDeath: {
        year: firstStageYear,
        deceasedName: firstDeceasedName,
        tax: firstTax,
        toSpouse: firstToSpouse,
        toTrusts: firstToTrusts,
        toHeirs: firstToHeirs,
        drainAttributions: firstAttributions,
        transfers: firstDeathTransfers,
        taxBreakdown: firstBreakdown,
      },
      combined: { value: combinedValue },
      secondDeath: {
        year: secondStageYear,
        deceasedName: finalDeceasedName,
        tax: secondTax,
        toTrusts: secondToTrusts,
        toHeirs: secondToHeirs,
        drainAttributions: secondAttributions,
        transfers: secondDeathTransfers,
        taxBreakdown: secondBreakdown,
      },
      beneficiaries,
      entities: tree.entities ?? [],
      totals: { taxesAndExpenses: totalTaxesAndExpenses, toHeirs: totalToHeirs },
    };
  }

  // ── "single-grantor" ─────────────────────────────────────────────────────
  // Covers: single filer (no spouse), or married but one death is outside window.
  // The "living" grantor is the one whose death falls inside the plan.
  if (finalDeathYear !== null) {
    // Determine which event represents the single death in the window
    const event: EstateTaxResult | undefined =
      withResult.secondDeathEvent ?? withResult.firstDeathEvent;

    const deathYear = event?.year ?? finalDeathYear;

    // Find the surviving grantor's name
    // If there's no spouse, it's always the client.
    // If there is a spouse but only one event, the living grantor is whoever
    // identifyFinalDeceased points to.
    let survivorName: string;
    if (!hasSpouse) {
      survivorName = client.firstName;
    } else {
      // One of the two deaths is outside the plan window — determine who the
      // surviving grantor is by checking which principal died before the plan start.
      const clientBirthYear = parseInt(client.dateOfBirth.slice(0, 4), 10);
      const spouseBirthYear = parseInt((client.spouseDob as string).slice(0, 4), 10);
      const clientDeathYear = clientBirthYear + (client.lifeExpectancy ?? 95);
      const spouseDeathYear = spouseBirthYear + (client.spouseLifeExpectancy ?? 95);
      const clientDead = clientDeathYear < planStartYear;
      const spouseDead = spouseDeathYear < planStartYear;

      if (clientDead && !spouseDead) {
        // Client pre-deceased the plan start; survivor is the spouse
        survivorName = client.spouseName ?? "Spouse";
      } else if (spouseDead && !clientDead) {
        // Spouse pre-deceased the plan start; survivor is the client
        survivorName = client.firstName;
      } else {
        // Both in-window but only the final death lands in the window
        // (first death is post-plan-end). Use identifyFinalDeceased.
        const firstDeceasedRole = firstDeathYear != null
          ? identifyDeceased(client, firstDeathYear)
          : null;
        const finalDeceasedRole = identifyFinalDeceased(client, firstDeceasedRole);
        survivorName =
          finalDeceasedRole === "client"
            ? client.firstName
            : client.spouseName ?? "Spouse";
      }
    }

    // Single-grantor only has a sole death event, so we read `branch.firstDeath`
    // from the hypothetical payload (the engine populates only `firstDeath` in
    // single-filer ordering).
    const isRealYearSelection =
      typeof asOf === "number" && asOf === deathYear;

    let ht: HypotheticalEstateTax | undefined;
    if (asOf !== "split" && !isRealYearSelection) {
      if (asOf === "today") {
        ht = withResult.todayHypotheticalEstateTax;
      } else if (typeof asOf === "number") {
        ht = withResult.years.find((y) => y.year === asOf)?.hypotheticalEstateTax;
      }
    }

    let stageDeathYear: number;
    let stageTax: number;
    let stageTransfers: DeathTransfer[];
    let stageAttributions: DrainAttribution[];
    let stageBreakdown: StageTaxBreakdown;

    if (ht) {
      stageDeathYear = ht.year;
      stageTax = ht.primaryFirst.firstDeath.totalTaxesAndExpenses;
      stageTransfers = ht.primaryFirst.firstDeathTransfers;
      stageAttributions = ht.primaryFirst.firstDeath.drainAttributions ?? [];
      stageBreakdown = extractTaxBreakdown(ht.primaryFirst.firstDeath);
    } else {
      const deathYearRow = withResult.years.find((y) => y.year === deathYear);
      const deathOrder: 1 | 2 = event?.deathOrder ?? (hasSpouse ? 2 : 1);
      stageDeathYear = deathYear;
      stageTax = event?.totalTaxesAndExpenses ?? 0;
      stageTransfers = (deathYearRow?.deathTransfers ?? []).filter(
        (t) => t.deathOrder === deathOrder,
      );
      stageAttributions = event?.drainAttributions ?? [];
      stageBreakdown = event ? extractTaxBreakdown(event) : zeroTaxBreakdown();
    }

    const toHeirs = sumToHeirs(stageTransfers, tree);
    const toTrusts = sumToTrusts(stageTransfers, tree);
    const beneficiaries = buildBeneficiaryCards(stageTransfers, tree, toHeirs);

    return {
      kind: "single-grantor",
      survivorName,
      today: { year: anchorYear },
      death: {
        year: stageDeathYear,
        tax: stageTax,
        toTrusts,
        toHeirs,
        drainAttributions: stageAttributions,
        transfers: stageTransfers,
        taxBreakdown: stageBreakdown,
      },
      beneficiaries,
      entities: tree.entities ?? [],
      totals: { taxesAndExpenses: stageTax, toHeirs },
    };
  }

  // Fallback — should not be reachable given the guards above
  return {
    kind: "historical",
    message: "Unable to determine death events for this plan.",
  };
}

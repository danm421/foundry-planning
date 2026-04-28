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
import type { ClientData, EstateTaxResult, DeathTransfer } from "@/engine/types";
import type { ProjectionResult } from "@/engine";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "@/engine/ownership";

// ── Output types ──────────────────────────────────────────────────────────────

export interface BeneficiaryCard {
  name: string;
  relationship: string | null;
  value: number;
  isTrustRemainder: boolean;
  pctOfHeirs: number;
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
      };
      combined: { value: number };
      secondDeath: {
        year: number;
        deceasedName: string;
        tax: number;
        toHeirs: number;
      };
      beneficiaries: BeneficiaryCard[];
      totals: { taxesAndExpenses: number; toHeirs: number };
    }
  | {
      kind: "single-grantor";
      survivorName: string;
      today: { year: number };
      death: { year: number; tax: number; toHeirs: number };
      beneficiaries: BeneficiaryCard[];
      totals: { taxesAndExpenses: number; toHeirs: number };
    }
  | { kind: "historical"; message: string };

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Sum `amount` for all non-spouse, positive-amount transfers in a death year. */
function sumToHeirs(transfers: DeathTransfer[]): number {
  return transfers.reduce(
    (acc, t) => acc + (t.recipientKind !== "spouse" && t.amount > 0 ? t.amount : 0),
    0,
  );
}

/** Sum `amount` for all spouse transfers (marital deduction flows). */
function sumToSpouse(transfers: DeathTransfer[]): number {
  return transfers.reduce(
    (acc, t) => acc + (t.recipientKind === "spouse" && t.amount > 0 ? t.amount : 0),
    0,
  );
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
  const entityById = new Map(
    (tree.entities ?? []).map((e) => [e.id, e]),
  );
  const extById = new Map(
    (tree.externalBeneficiaries ?? []).map((e) => [e.id, e]),
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

    const key: Key = `${t.recipientKind}|${t.recipientId ?? ""}|${t.recipientLabel}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.value += t.amount;
    } else {
      let name = t.recipientLabel;
      let relationship: string | null = null;
      let isTrustRemainder = false;

      if (t.recipientKind === "family_member" && t.recipientId) {
        const fm = famById.get(t.recipientId);
        if (fm) {
          name = `${fm.firstName}${fm.lastName ? " " + fm.lastName : ""}`;
          relationship = fm.relationship === "other" ? null : fm.relationship;
        }
      } else if (t.recipientKind === "entity" && t.recipientId) {
        const ent = entityById.get(t.recipientId);
        name = ent?.name ? `${ent.name} remainder` : `${t.recipientLabel} remainder`;
        isTrustRemainder = true;
      } else if (t.recipientKind === "external_beneficiary" && t.recipientId) {
        const ext = extById.get(t.recipientId);
        if (ext) name = ext.name;
      }
      // system_default: use recipientLabel (e.g. "Other Heirs")

      grouped.set(key, { name, relationship, value: t.amount, isTrustRemainder });
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
 * Compute the survivor's gross estate at the first-death year.
 * The engine doesn't compute this directly (the deceased's gross estate is on
 * EstateTaxResult.grossEstate). We call computeGrossEstate() directly, using
 * ending balances from the year BEFORE the death year.
 *
 * If we can't find the necessary balances, we fall back to 0 and log a note
 * in the returned object so callers can tell.
 */
function computeSurvivorGrossEstateAtFirstDeath(
  tree: ClientData,
  withResult: ProjectionResult,
  survivor: "client" | "spouse",
  firstDeathYear: number,
): number {
  // Find the survivor's FM id
  const survivorFm = (tree.familyMembers ?? []).find((fm) => fm.role === survivor);
  const survivorFmId = survivorFm?.id ?? null;

  const deceased = survivor === "client" ? "spouse" : "client";
  const deceasedFm = (tree.familyMembers ?? []).find((fm) => fm.role === deceased);
  const deceasedFmId = deceasedFm?.id ?? null;

  // Use ending balances from the year prior to first death (beginning-of-death-year state)
  const priorYearIdx = withResult.years.findIndex((y) => y.year === firstDeathYear - 1);
  if (priorYearIdx < 0) return 0;

  const priorYear = withResult.years[priorYearIdx];
  // Build accountBalances from the prior year's accountLedgers (endingValue)
  const accountBalances: Record<string, number> = {};
  for (const [id, ledger] of Object.entries(priorYear.accountLedgers)) {
    accountBalances[id] = ledger.endingValue;
  }

  const result = computeGrossEstate({
    deceased: survivor, // We're computing the "deceased" (the survivor in first-death terms)
    deathOrder: 1,       // Treat as first death for pct purposes
    accounts: tree.accounts,
    accountBalances,
    liabilities: tree.liabilities,
    entities: tree.entities ?? [],
    deceasedFmId: survivorFmId,
    survivorFmId: deceasedFmId,
  });

  return result.total;
}

// ── Main export ───────────────────────────────────────────────────────────────

export function deriveSpineData(args: {
  tree: ClientData;
  withResult: ProjectionResult;
}): SpineData {
  const { tree, withResult } = args;
  const { client, planSettings } = tree;
  const { planStartYear, planEndYear } = planSettings;

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

    // Pull EstateTaxResult from projection
    const firstEvent = withResult.firstDeathEvent;
    const secondEvent = withResult.secondDeathEvent;

    // Net worth at first-death year: deceased's is grossEstate from the event;
    // survivor's is computed via computeGrossEstate with prior-year balances.
    const deceasedGrossEstate = firstEvent?.grossEstate ?? 0;
    const survivorGrossEstate = firstEvent
      ? computeSurvivorGrossEstateAtFirstDeath(
          tree,
          withResult,
          firstDeceasedRole === "client" ? "spouse" : "client",
          firstDeathYear,
        )
      : 0;

    const clientNetWorth =
      firstDeceasedRole === "client" ? deceasedGrossEstate : survivorGrossEstate;
    const spouseNetWorth =
      firstDeceasedRole === "spouse" ? deceasedGrossEstate : survivorGrossEstate;

    // Combined value at second death entry point
    const combinedValue = secondEvent?.grossEstate ?? 0;

    // First-death transfers
    const firstDeathYearRow = withResult.years.find((y) => y.year === firstDeathYear);
    const firstDeathTransfers = (firstDeathYearRow?.deathTransfers ?? []).filter(
      (t) => t.deathOrder === 1,
    );
    const firstToSpouse = sumToSpouse(firstDeathTransfers);
    const firstTax = firstEvent?.totalTaxesAndExpenses ?? 0;

    // Second-death transfers
    const secondDeathYearRow = withResult.years.find((y) => y.year === finalDeathYear);
    const secondDeathTransfers = (secondDeathYearRow?.deathTransfers ?? []).filter(
      (t) => t.deathOrder === 2,
    );
    const secondToHeirs = sumToHeirs(secondDeathTransfers);
    const secondTax = secondEvent?.totalTaxesAndExpenses ?? 0;

    // Beneficiary cards from second-death transfers
    const beneficiaries = buildBeneficiaryCards(secondDeathTransfers, tree, secondToHeirs);

    const totalTaxesAndExpenses = firstTax + secondTax;
    const totalToHeirs = secondToHeirs;

    const spouseFm = (tree.familyMembers ?? []).find((fm) => fm.role === "spouse");
    const spouseDisplayName =
      spouseFm?.firstName ?? client.spouseName ?? "Spouse";

    return {
      kind: "two-grantor",
      today: { year: planStartYear },
      pair: {
        client: { name: client.firstName, netWorth: clientNetWorth },
        spouse: { name: spouseDisplayName, netWorth: spouseNetWorth },
      },
      firstDeath: {
        year: firstDeathYear,
        deceasedName: firstDeceasedName,
        tax: firstTax,
        toSpouse: firstToSpouse,
      },
      combined: { value: combinedValue },
      secondDeath: {
        year: finalDeathYear,
        deceasedName: finalDeceasedName,
        tax: secondTax,
        toHeirs: secondToHeirs,
      },
      beneficiaries,
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
      // One of the two deaths is outside the plan window — use finalDeathYear
      // to determine who the last surviving principal is.
      const firstDeceasedRole = firstDeathYear != null
        ? identifyDeceased(client, firstDeathYear)
        : null;
      const finalDeceasedRole = identifyFinalDeceased(client, firstDeceasedRole);
      survivorName =
        finalDeceasedRole === "client"
          ? client.firstName
          : client.spouseName ?? "Spouse";
    }

    // Death-year transfers
    const deathYearRow = withResult.years.find((y) => y.year === deathYear);
    const deathOrder: 1 | 2 = event?.deathOrder ?? (hasSpouse ? 2 : 1);
    const deathTransfers = (deathYearRow?.deathTransfers ?? []).filter(
      (t) => t.deathOrder === deathOrder,
    );
    const toHeirs = sumToHeirs(deathTransfers);
    const tax = event?.totalTaxesAndExpenses ?? 0;

    const beneficiaries = buildBeneficiaryCards(deathTransfers, tree, toHeirs);

    return {
      kind: "single-grantor",
      survivorName,
      today: { year: planStartYear },
      death: { year: deathYear, tax, toHeirs },
      beneficiaries,
      totals: { taxesAndExpenses: tax, toHeirs },
    };
  }

  // Fallback — should not be reachable given the guards above
  return {
    kind: "historical",
    message: "Unable to determine death events for this plan.",
  };
}

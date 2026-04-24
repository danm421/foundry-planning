import type {
  Account, Liability, DeathTransfer, Will, Income, EntitySummary,
  EstateTaxResult,
} from "../types";
import {
  applyBeneficiaryDesignations,
  applyFallback,
  applyIncomeTermination,
  applyWillAllAssetsResidual,
  applyWillSpecificBequests,
  distributeUnlinkedLiabilities,
  runPourOut,
  type DeathEventInput,
  type DeathEventResult,
} from "./shared";
import {
  buildEstateTaxResult,
  computeDeductions,
  computeGrossEstate,
} from "./estate-tax";
import { applyGrantorSuccession } from "./grantor-succession";
import { drainLiquidAssets } from "./creditor-payoff";
import { applyLiabilityBequests } from "./liability-bequests";
import { beaForYear } from "@/lib/tax/estate";
import { computeAdjustedTaxableGifts } from "@/lib/estate/adjusted-taxable-gifts";

interface FinalDeathChainResult {
  accounts: Account[];
  accountBalances: Record<string, number>;
  basisMap: Record<string, number>;
  incomes: Income[];
  liabilities: Liability[];
  transfers: DeathTransfer[];
  warnings: string[];
}

/** The 4c precedence chain (no titling — no joint accounts at final death —
 *  designations → will with deathOrder=2 → fallback with survivor=null so
 *  tier 1 is skipped and tiers 2/3 handle the residual). Returns raw post-
 *  chain state; the 4d orchestrator layers drain + tax + pour-out around it. */
function runFinalDeathPrecedenceChain(input: DeathEventInput): FinalDeathChainResult {
  const {
    year, deceased, will,
    accounts, accountBalances, basisMap,
    incomes, liabilities,
    familyMembers, externalBeneficiaries, entities,
  } = input;

  // Defensive: no joint accounts can exist at 4c. Entity/family-member-owned
  // accounts are exempt — the `owner` enum is ignored when those IDs are set
  // (see accounts schema: ownerEntityId > ownerFamilyMemberId > owner), and
  // they're skipped by the chain below for the same reason.
  for (const a of accounts) {
    if (a.owner === "joint" && !a.ownerEntityId && !a.ownerFamilyMemberId) {
      throw new Error(
        `applyFinalDeath invariant: account ${a.id} still has owner='joint' at final death (should have been retitled at 4b)`,
      );
    }
  }

  const nextAccounts: Account[] = [];
  const nextLiabilities: Liability[] = [...liabilities];
  const nextAccountBalances: Record<string, number> = { ...accountBalances };
  const nextBasisMap: Record<string, number> = { ...basisMap };
  const assetTransfers: DeathTransfer[] = [];
  const warnings: string[] = [];

  const deceasedWill: Will | null = will && will.grantor === deceased ? will : null;

  for (const acct of accounts) {
    const touchedByDeceased = acct.owner === deceased;
    if (!touchedByDeceased || acct.ownerEntityId || acct.ownerFamilyMemberId) {
      nextAccounts.push(acct);
      continue;
    }

    const linkedLiability = liabilities.find((l) => l.linkedPropertyId === acct.id);

    const balance = accountBalances[acct.id];
    const basis = basisMap[acct.id];
    if (balance == null || basis == null) {
      throw new Error(
        `applyFinalDeath: missing accountBalances/basisMap entry for ${acct.id}`,
      );
    }
    const effectiveAcct: Account = { ...acct, value: balance, basis };

    let undisposed = 1;
    let anySpecificClauseTouched = false;
    const stepAccts: Account[] = [];
    const stepLiabs: Liability[] = [];
    const stepLedger: Array<Omit<DeathTransfer, "year" | "deceased" | "deathOrder">> = [];

    // Step 1 is a no-op at 4c (no joint accounts). Skip directly to step 2.

    // Step 2: Beneficiary designations
    const step2 = applyBeneficiaryDesignations(
      effectiveAcct, undisposed,
      familyMembers, externalBeneficiaries, linkedLiability,
    );
    if (step2.fractionClaimed > 0) {
      stepAccts.push(...step2.resultingAccounts);
      stepLiabs.push(...step2.resultingLiabilities);
      stepLedger.push(...step2.ledgerEntries);
      undisposed -= step2.fractionClaimed;
    }

    // Step 3a: Specific bequests (deathOrder=2)
    if (undisposed > 1e-9 && deceasedWill) {
      const step3a = applyWillSpecificBequests(
        effectiveAcct, undisposed, deceasedWill, 2, null,
        familyMembers, externalBeneficiaries, entities, linkedLiability,
      );
      if (step3a.fractionClaimed > 0) {
        stepAccts.push(...step3a.resultingAccounts);
        stepLiabs.push(...step3a.resultingLiabilities);
        stepLedger.push(...step3a.ledgerEntries);
        undisposed -= step3a.fractionClaimed;
        anySpecificClauseTouched = true;
        warnings.push(...step3a.warnings);
      }
    }

    // Step 3b: all_assets residual (deathOrder=2)
    if (undisposed > 1e-9 && deceasedWill) {
      const step3b = applyWillAllAssetsResidual(
        effectiveAcct, undisposed, anySpecificClauseTouched, deceasedWill, 2, null,
        familyMembers, externalBeneficiaries, entities, linkedLiability,
      );
      if (step3b.fractionClaimed > 0) {
        stepAccts.push(...step3b.resultingAccounts);
        stepLiabs.push(...step3b.resultingLiabilities);
        stepLedger.push(...step3b.ledgerEntries);
        undisposed -= step3b.fractionClaimed;
      }
    }

    // Step 4: Fallback with survivor=null — tier 1 skipped; tiers 2/3 live.
    if (undisposed > 1e-9) {
      const step4 = applyFallback(
        effectiveAcct, undisposed, null, familyMembers, linkedLiability,
      );
      stepAccts.push(...step4.step.resultingAccounts);
      stepLiabs.push(...step4.step.resultingLiabilities);
      stepLedger.push(...step4.step.ledgerEntries);
      warnings.push(...step4.warnings);
      undisposed = 0;
    }

    for (const entry of stepLedger) {
      assetTransfers.push({ ...entry, year, deceased, deathOrder: 2 });
    }

    delete nextAccountBalances[acct.id];
    delete nextBasisMap[acct.id];
    for (const a of stepAccts) {
      nextAccounts.push(a);
      nextAccountBalances[a.id] = a.value;
      nextBasisMap[a.id] = a.basis;
    }

    if (linkedLiability) {
      const idx = nextLiabilities.findIndex((l) => l.id === linkedLiability.id);
      if (idx >= 0) nextLiabilities.splice(idx, 1);
      for (const lib of stepLiabs) nextLiabilities.push(lib);
    }
  }

  // Income termination — reuse the 4b helper. At 4c there are no joint
  // accounts to retitle; the survivor arg to the helper is only used for
  // joint-income retitling and doesn't matter here, so we pass deceased.
  const nextIncomes = applyIncomeTermination(incomes, deceased, deceased, year);

  return {
    accounts: nextAccounts,
    accountBalances: nextAccountBalances,
    basisMap: nextBasisMap,
    incomes: nextIncomes,
    liabilities: nextLiabilities,
    transfers: assetTransfers,
    warnings,
  };
}

/** 4d-1 orchestrator — final-death with pipeline inversion. Creditor-payoff
 *  and estate-tax drains debit accounts BEFORE the 4c precedence chain
 *  distributes the residual. Trust pour-outs fold in as a preceding step to
 *  the chain. Residual unlinked debt falls back to the old proportional-
 *  distribution helper post-chain. */
export function applyFinalDeath(input: DeathEventInput): DeathEventResult {
  const warnings: string[] = [];

  // Phase 2 — compute grantor-succession updates (not yet applied). Defer
  // application until after gross-estate + drains read pre-flip state.
  const succession = applyGrantorSuccession({
    deceased: input.deceased,
    entities: input.entities,
  });
  warnings.push(...succession.warnings);

  // Phase 3 — gross estate (pre-drain, pre-mutate).
  const gross = computeGrossEstate({
    deceased: input.deceased,
    deathOrder: 2,
    accounts: input.accounts,
    accountBalances: input.accountBalances,
    liabilities: input.liabilities,
    entities: input.entities,
  });

  // Working state for the drain passes.
  const accountBalances = { ...input.accountBalances };
  let workingLiabs = [...input.liabilities];
  let ledger: DeathTransfer[] = [];

  // Phase 2.5 (4e) — carve bequeathed unlinked-debt slices out of the
  // creditor-payoff pool before the drain runs. Gross estate was already
  // computed against the original liability list (Form 706 is agnostic
  // about who pays), so this only affects downstream drain + chain.
  const bequestResult = applyLiabilityBequests({
    will: input.will,
    deceased: input.deceased,
    liabilities: workingLiabs,
    familyMembers: input.familyMembers,
    entities: input.entities,  // pre-succession snapshot
    year: input.year,
  });
  workingLiabs = [
    ...bequestResult.updatedLiabilities,
    ...bequestResult.newLiabilityRows,
  ];
  ledger = ledger.concat(bequestResult.bequestTransfers);
  warnings.push(...bequestResult.warnings);

  // Phase 4 — creditor-payoff drain. Pay off unlinked household debt from
  // the deceased's liquid accounts (proportional inside each category, fixed
  // category order cash → taxable → life_insurance → retirement).
  const unlinkedDebt = workingLiabs
    .filter(
      (l) =>
        l.linkedPropertyId == null &&
        l.ownerEntityId == null &&
        l.ownerFamilyMemberId == null,
    )
    .reduce((sum, l) => sum + l.balance, 0);

  const creditorDrain = drainLiquidAssets({
    amountNeeded: unlinkedDebt,
    accounts: input.accounts,
    accountBalances,
    eligibilityFilter: (a) => {
      if (a.ownerFamilyMemberId) return false;
      if (a.ownerEntityId) {
        const ent = input.entities.find((e) => e.id === a.ownerEntityId);
        if (!ent) return false;
        if (ent.isIrrevocable) return false;
        if (ent.grantor !== input.deceased) return false;
        return true;
      }
      return a.owner === input.deceased;
    },
  });

  for (const debit of creditorDrain.debits) {
    accountBalances[debit.accountId] = (accountBalances[debit.accountId] ?? 0) - debit.amount;
    const a = input.accounts.find((x) => x.id === debit.accountId);
    if (a && a.category === "retirement") warnings.push(`retirement_estate_drain: ${a.id}`);
  }

  // Reduce each unlinked liability by the drain ratio so the residual (if
  // any) flows to Phase 8's proportional-distribution fallback.
  if (unlinkedDebt > 0) {
    const ratio = creditorDrain.drainedTotal / unlinkedDebt;
    workingLiabs = workingLiabs.map((l) => {
      if (l.linkedPropertyId || l.ownerEntityId || l.ownerFamilyMemberId) return l;
      return { ...l, balance: l.balance * (1 - ratio) };
    });
  }
  if (creditorDrain.residual > 0) {
    warnings.push(`creditor_payoff_insufficient_liquid: ${creditorDrain.residual.toFixed(2)}`);
  }

  // Phase 5 — preliminary deductions. Charitable deduction is unknown until
  // the chain runs (it's derived from the transfer ledger). Marital is 0 at
  // final death. Admin is known up-front.
  const preliminaryDeductions = {
    maritalDeduction: 0,
    charitableDeduction: 0,
    estateAdminExpenses: input.planSettings.estateAdminExpenses ?? 0,
  };

  const adjustedGifts = computeAdjustedTaxableGifts(
    input.deceased,
    input.gifts,
    input.entities,
    input.annualExclusionsByYear,
  );
  const taxInflation =
    input.planSettings.taxInflationRate ?? input.planSettings.inflationRate ?? 0;
  const beaAtDeathYear = beaForYear(input.year, taxInflation);

  // Phase 5/6 — preview tax result so we know how much liquidity the
  // estate-tax drain needs. Charitable=0 here → this is an upper bound;
  // the charitable deduction is refined in Phase 9's final build.
  const previewResult = buildEstateTaxResult({
    year: input.year,
    deathOrder: 2,
    deceased: input.deceased,
    gross,
    deductions: preliminaryDeductions,
    adjustedTaxableGifts: adjustedGifts,
    lifetimeGiftTaxAdjustment: 0,
    beaAtDeathYear,
    dsueReceived: input.dsueReceived,
    stateEstateTaxRate: input.planSettings.flatStateEstateRate ?? 0,
    estateTaxDebits: [],
    creditorPayoffDebits: creditorDrain.debits,
    creditorPayoffResidual: creditorDrain.residual,
  });

  // Phase 6 — estate-tax drain on deceased's + grantor-trust liquid assets.
  const estateTaxDrain = drainLiquidAssets({
    amountNeeded: previewResult.totalTaxesAndExpenses,
    accounts: input.accounts,
    accountBalances,
    eligibilityFilter: (a) => {
      if (a.ownerFamilyMemberId) return false;
      if (a.ownerEntityId) {
        const ent = input.entities.find((e) => e.id === a.ownerEntityId);
        if (!ent) return false;
        if (ent.isIrrevocable) return false;
        if (ent.grantor !== input.deceased) return false;
        return true;
      }
      return a.owner === input.deceased;
    },
  });

  for (const debit of estateTaxDrain.debits) {
    accountBalances[debit.accountId] = (accountBalances[debit.accountId] ?? 0) - debit.amount;
    const a = input.accounts.find((x) => x.id === debit.accountId);
    if (a && a.category === "retirement") warnings.push(`retirement_estate_drain: ${a.id}`);
  }
  if (estateTaxDrain.residual > 0) {
    warnings.push(`estate_tax_insufficient_liquid: ${estateTaxDrain.residual.toFixed(2)}`);
  }

  // Phase 7 — apply grantor-succession updates now that gross estate + drains
  // have read pre-flip state. The chain and pour-out both see mutated entities.
  const mutatedEntities = input.entities.map((e) => {
    const upd = succession.entityUpdates.find((u) => u.entityId === e.id);
    if (!upd) return e;
    return {
      ...e,
      ...(upd.isGrantor !== undefined ? { isGrantor: upd.isGrantor } : {}),
      ...(upd.isIrrevocable !== undefined ? { isIrrevocable: upd.isIrrevocable } : {}),
      ...(upd.grantor !== undefined ? { grantor: upd.grantor ?? undefined } : {}),
    };
  });

  // Phase 8a — pour-out fold-in BEFORE the chain's will step runs. Trust
  // accounts pour to their beneficiaries; trust liabilities have their
  // ownerEntityId stripped so they join the unlinked-debt redistribution.
  if (succession.pourOutQueue.length > 0) {
    const pourOut = runPourOut({
      queue: succession.pourOutQueue,
      deceased: input.deceased,
      deathOrder: 2,
      accounts: input.accounts,
      accountBalances,
      liabilities: workingLiabs,
      familyMembers: input.familyMembers,
      externalBeneficiaries: input.externalBeneficiaries,
      entities: mutatedEntities,
      year: input.year,
    });
    ledger = ledger.concat(pourOut.transfers);
    workingLiabs = pourOut.liabilities;
    warnings.push(...pourOut.warnings);
  }

  // Phase 8b — the 4c precedence chain, now running LAST. Accounts already
  // drained; entities already flipped; trust assets already poured.
  const chainResult = runFinalDeathPrecedenceChain({
    ...input,
    accounts: input.accounts,
    accountBalances,
    liabilities: workingLiabs,
    entities: mutatedEntities,
  });
  ledger = ledger.concat(chainResult.transfers);
  workingLiabs = chainResult.liabilities;
  warnings.push(...chainResult.warnings);

  // Phase 8c — residual unlinked-debt distribution. Fires only if the
  // creditor-payoff drain couldn't cover everything (e.g., illiquid estate).
  if (creditorDrain.residual > 0) {
    const residualDist = distributeUnlinkedLiabilities(
      workingLiabs,
      ledger,
      input.year,
      input.deceased,
    );
    ledger = ledger.concat(residualDist.liabilityTransfers);
    workingLiabs = residualDist.updatedLiabilities;
    warnings.push(...residualDist.warnings);
  }

  // Phase 9 — final deductions (charitable now derivable from ledger).
  const finalDeductions = computeDeductions({
    transferLedger: ledger,
    externalBeneficiaries: input.externalBeneficiaries,
    planSettings: input.planSettings,
    deathOrder: 2,
  });

  const estateTax = buildEstateTaxResult({
    year: input.year,
    deathOrder: 2,
    deceased: input.deceased,
    gross,
    deductions: finalDeductions,
    adjustedTaxableGifts: adjustedGifts,
    lifetimeGiftTaxAdjustment: 0,
    beaAtDeathYear,
    dsueReceived: input.dsueReceived,
    stateEstateTaxRate: input.planSettings.flatStateEstateRate ?? 0,
    estateTaxDebits: estateTaxDrain.debits,
    creditorPayoffDebits: creditorDrain.debits,
    creditorPayoffResidual: creditorDrain.residual,
  });

  assertFinalDeathInvariants(estateTax, mutatedEntities, input.deceased, ledger, workingLiabs, input.liabilities);

  return {
    accounts: chainResult.accounts,
    accountBalances,
    basisMap: chainResult.basisMap,
    incomes: chainResult.incomes,
    liabilities: workingLiabs,
    transfers: ledger,
    warnings,
    estateTax,
    dsueGenerated: 0,
  };
}

/** 4d-specific invariants on the estate-tax result + post-succession entity state. */
function assertFinalDeathInvariants(
  estateTax: EstateTaxResult,
  entities: EntitySummary[],
  deceased: "client" | "spouse",
  ledger: DeathTransfer[],
  workingLiabs: Liability[],
  originalLiabilities: Liability[],
): void {
  // grossEstate can be negative when the decedent owns no individual assets
  // but proportional household-debt attribution lands on them (4d-2 hypothetical
  // ordering exposes this; real-death flows never hit it). taxableEstate is
  // clamped to 0 downstream, so the math stays correct — only relax the guard.
  if (estateTax.taxableEstate < 0) throw new Error("final-death: taxable estate negative");
  if (estateTax.federalEstateTax < 0) throw new Error("final-death: federal tax negative");
  if (estateTax.stateEstateTax < 0) throw new Error("final-death: state tax negative");
  if (estateTax.dsueGenerated !== 0) {
    throw new Error("final-death: dsueGenerated must be 0");
  }
  if (estateTax.applicableExclusion !== estateTax.beaAtDeathYear + estateTax.dsueReceived) {
    throw new Error("final-death: applicableExclusion drift");
  }
  for (const e of entities) {
    if (!e.isIrrevocable && e.grantor === deceased) {
      throw new Error(`final-death: entity ${e.id} revocable + grantor=deceased was not flipped`);
    }
  }

  // 4e invariants — liability bequests
  const bequestLedger = ledger.filter((t) => t.via === "will_liability_bequest");
  for (const t of bequestLedger) {
    if (t.sourceLiabilityId == null) {
      throw new Error(`[4e] will_liability_bequest missing sourceLiabilityId`);
    }
  }
  // Σ|amount| per sourceLiabilityId must not exceed the pre-bequest balance
  const bequestTotalsBySource = new Map<string, number>();
  for (const t of bequestLedger) {
    const id = t.sourceLiabilityId!;
    bequestTotalsBySource.set(id, (bequestTotalsBySource.get(id) ?? 0) + Math.abs(t.amount));
  }
  for (const [liabId, total] of bequestTotalsBySource.entries()) {
    const original = originalLiabilities.find((l) => l.id === liabId);
    if (original && total > original.balance + 0.01) {
      throw new Error(`[4e] bequest sum ${total} exceeds pre-bequest balance ${original.balance} for ${liabId}`);
    }
  }
  // New liability rows from bequests: exactly one ownership kind set
  for (const row of workingLiabs) {
    if (!row.id.startsWith("death-liab-bequest")) continue;
    const fam = row.ownerFamilyMemberId != null;
    const ent = row.ownerEntityId != null;
    if (fam === ent) {
      throw new Error(`[4e] bequest-derived liability ${row.id} must have exactly one of ownerFamilyMemberId / ownerEntityId set`);
    }
  }
}

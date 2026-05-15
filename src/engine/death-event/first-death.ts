import type {
  Account, Liability, DeathTransfer, Will, Income, EntitySummary,
  EstateTaxResult,
} from "../types";
import {
  applyBeneficiaryDesignations,
  applyFallback,
  applyIncomeTermination,
  applyTitling,
  applyWillAllAssetsResidual,
  applyWillSpecificBequests,
  computeSteppedUpBasis,
  distributeFirstDeathUnlinkedLiabilities,
  runPourOut,
  type DeathEventInput,
  type DeathEventResult,
} from "./shared";
import { controllingEntity, isFullyEntityOwned, isFullyHouseholdOwned, ownedByHousehold, controllingFamilyMember } from "../ownership";
import {
  buildEstateTaxResult,
  computeDeductions,
  computeGrossEstate,
} from "./estate-tax";
import { applyGrantorSuccession } from "./grantor-succession";
import { drainLiquidAssets } from "./creditor-payoff";
import { prepareLifeInsurancePayouts } from "./life-insurance-payout";
import {
  assertDrainAttributionsReconcile,
  attributeDrainsToLedger,
} from "./drain-attribution";
import { computeIrdAttributions } from "./ird-tax";
import { beaForYear } from "@/lib/tax/estate";
import { computeAdjustedTaxableGifts } from "@/lib/estate/adjusted-taxable-gifts";

interface FirstDeathChainResult {
  accounts: Account[];
  accountBalances: Record<string, number>;
  basisMap: Record<string, number>;
  incomes: Income[];
  liabilities: Liability[];
  transfers: DeathTransfer[];
  warnings: string[];
}

/** Phase 1 — the 4b precedence chain (titling → bene-designations → will →
 *  fallback) run against every account touched by the deceased. Returns the
 *  raw post-chain state; the 4d orchestrator layers gross-estate, tax, drain,
 *  grantor-succession, and pour-out on top. */
function runFirstDeathPrecedenceChain(input: DeathEventInput): FirstDeathChainResult {
  const {
    year, deceased, survivor, will,
    accounts, accountBalances, basisMap,
    incomes, liabilities,
    familyMembers, externalBeneficiaries, entities,
  } = input;

  // Resolve household principal FM ids for ownership comparisons.
  const deceasedFmId = familyMembers.find((fm) => fm.role === deceased)?.id ?? null;
  const survivorFmId = familyMembers.find((fm) => fm.role === survivor)?.id ?? null;

  const nextAccounts: Account[] = [];
  const nextLiabilities: Liability[] = [...liabilities];
  const nextAccountBalances: Record<string, number> = { ...accountBalances };
  const nextBasisMap: Record<string, number> = { ...basisMap };
  const transfers: DeathTransfer[] = [];
  const warnings: string[] = [];

  // Build a per-will map for quick lookups. Only the deceased's will matters.
  const deceasedWill: Will | null = will && will.grantor === deceased ? will : null;

  for (const acct of accounts) {
    // Accounts not touched by the deceased pass through unchanged.
    // Entity-owned accounts and accounts already distributed to a non-principal
    // FM (ownerFamilyMemberId semantics) are also skipped.
    const cfm = controllingFamilyMember(acct);
    const isDeceasedOwned = cfm === deceasedFmId && deceasedFmId != null;
    const isJoint = ownedByHousehold(acct) > 0.0001 && cfm == null && !isFullyEntityOwned(acct);
    const touchedByDeceased = isDeceasedOwned || isJoint;
    // isHeirOwned: sole FM owner is not a household principal (already distributed to heir)
    const isHeirOwned = cfm != null && cfm !== deceasedFmId && cfm !== survivorFmId;
    if (!touchedByDeceased || isFullyEntityOwned(acct) || isHeirOwned) {
      nextAccounts.push(acct);
      continue;
    }

    // Collect the linked liability (if any) — we'll replace it on the
    // accumulator list once we know what the account split becomes.
    const linkedLiability = liabilities.find((l) => l.linkedPropertyId === acct.id);

    // Build an adjusted copy that carries the current (grown) balance and
    // the §1014 stepped-up basis. workingAccounts[i].value / .basis are
    // plan-start snapshots; accountBalances[id] / basisMap[id] are
    // authoritative year-end values. computeSteppedUpBasis returns FMV for
    // in-estate taxable / real-estate / business / cash, half-step-up for
    // JTWROS at first death, and the original basis for retirement / life-
    // insurance (IRD — no step-up).
    const balance = accountBalances[acct.id];
    const originalBasis = basisMap[acct.id];
    if (balance == null || originalBasis == null) {
      throw new Error(
        `applyFirstDeath: missing accountBalances/basisMap entry for ${acct.id}`,
      );
    }
    const steppedBasis = computeSteppedUpBasis(
      acct.category, balance, originalBasis,
      { isJointAtFirstDeath: isJoint },
    );
    const effectiveAcct: Account = { ...acct, value: balance, basis: steppedBasis };

    // Track remaining undisposed fraction for this account.
    let undisposed = 1; // always 100% of the deceased's share goes through the chain
    let anySpecificClauseTouched = false;
    const stepAccts: Account[] = [];
    const stepLiabs: Liability[] = [];
    const stepLedger: Array<Omit<DeathTransfer, "year" | "deceased" | "deathOrder">> = [];

    // Step 1: Titling
    const step1 = applyTitling(effectiveAcct, survivor, linkedLiability, survivorFmId ?? "");
    if (step1.consumed) {
      stepAccts.push(...step1.resultingAccounts);
      stepLiabs.push(...step1.resultingLiabilities);
      stepLedger.push(...step1.ledgerEntries);
      undisposed = 0;
    }

    // Step 2: Beneficiary designations
    if (undisposed > 1e-9) {
      const step2 = applyBeneficiaryDesignations(
        effectiveAcct, undisposed,
        familyMembers, externalBeneficiaries, entities, linkedLiability,
      );
      if (step2.fractionClaimed > 0) {
        stepAccts.push(...step2.resultingAccounts);
        stepLiabs.push(...step2.resultingLiabilities);
        stepLedger.push(...step2.ledgerEntries);
        undisposed -= step2.fractionClaimed;
      }
    }

    // Step 3a: Specific bequests
    if (undisposed > 1e-9 && deceasedWill) {
      const step3a = applyWillSpecificBequests(
        effectiveAcct, undisposed, deceasedWill, 1, survivor, survivorFmId,
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

    // Step 3b: all_assets residual (only if no specific clause touched this account)
    if (undisposed > 1e-9 && deceasedWill) {
      const step3b = applyWillAllAssetsResidual(
        effectiveAcct, undisposed, anySpecificClauseTouched, deceasedWill, 1, survivor, survivorFmId,
        familyMembers, externalBeneficiaries, entities, linkedLiability,
      );
      if (step3b.fractionClaimed > 0) {
        stepAccts.push(...step3b.resultingAccounts);
        stepLiabs.push(...step3b.resultingLiabilities);
        stepLedger.push(...step3b.ledgerEntries);
        undisposed -= step3b.fractionClaimed;
      }
    }

    // Step 4: Fallback
    if (undisposed > 1e-9) {
      const step4 = applyFallback(
        effectiveAcct, undisposed, survivor, survivorFmId, familyMembers, linkedLiability,
      );
      stepAccts.push(...step4.step.resultingAccounts);
      stepLiabs.push(...step4.step.resultingLiabilities);
      stepLedger.push(...step4.step.ledgerEntries);
      warnings.push(...step4.warnings);
      undisposed = 0;
    }

    // Emit ledger (with year + deceased + deathOrder populated) and fold accumulators
    for (const entry of stepLedger) {
      transfers.push({ ...entry, year, deceased, deathOrder: 1 });
    }

    // Replace `acct` in the accounts list with the step-produced accounts.
    // Also: remove the old account's balance / basis maps and add new ones.
    delete nextAccountBalances[acct.id];
    delete nextBasisMap[acct.id];
    for (const a of stepAccts) {
      nextAccounts.push(a);
      nextAccountBalances[a.id] = a.value;
      nextBasisMap[a.id] = a.basis;
    }

    // Swap liability records: drop the original linked liability (if any) and
    // add the new split liabilities.
    if (linkedLiability) {
      const idx = nextLiabilities.findIndex((l) => l.id === linkedLiability.id);
      if (idx >= 0) nextLiabilities.splice(idx, 1);
      for (const lib of stepLiabs) nextLiabilities.push(lib);
    }
  }

  // Income termination
  const nextIncomes = applyIncomeTermination(incomes, deceased, survivor, year);

  return {
    accounts: nextAccounts,
    accountBalances: nextAccountBalances,
    basisMap: nextBasisMap,
    incomes: nextIncomes,
    liabilities: nextLiabilities,
    transfers,
    warnings,
  };
}

/** 4d-1 orchestrator. Wraps the precedence chain with:
 *    · grantor-succession compute (Phase 2)
 *    · gross-estate builder (Phase 3) — reads pre-flip state
 *    · deduction stack (Phase 4)
 *    · estate-tax compute-then-drain (Phases 5 & 8) on non-marital residuary
 *    · grantor-succession apply + pour-out (Phases 9-10)
 *    · final EstateTaxResult with drain debits populated (Phase 11)
 *  No creditor-payoff at first death. */
export function applyFirstDeath(input: DeathEventInput): DeathEventResult {
  // Resolve household principal FM ids — needed in the orchestrator for
  // computeGrossEstate and the estate-tax drain eligibility filter.
  const deceasedFmId =
    input.familyMembers.find((fm) => fm.role === input.deceased)?.id ?? null;
  const survivorFmId =
    input.familyMembers.find((fm) => fm.role === (input.survivor ?? ""))?.id ?? null;

  // Phase 0 — life-insurance pre-chain transform. Triggering policies have
  // their cash value swapped for faceValue and are reclassified as cash, so
  // the chain routes them via per-account beneficiaries / will / fallback
  // naturally. computeGrossEstate then picks up faceValue via the existing
  // owner / grantor-revocable rules (§2042-equivalent).
  const li = prepareLifeInsurancePayouts({
    year: input.year,
    deceased: input.deceased,
    eventKind: "first_death",
    accounts: input.accounts,
    accountBalances: input.accountBalances,
    basisMap: input.basisMap,
    entities: input.entities,
  });

  const prepared: DeathEventInput = {
    ...input,
    accounts: li.accounts,
    accountBalances: li.accountBalances,
    basisMap: li.basisMap,
  };

  // Phase 1 — 4b precedence chain. Capture its transfer ledger + state.
  const chainResult = runFirstDeathPrecedenceChain(prepared);

  // Phase 2 — compute grantor-succession updates (not yet applied).
  const succession = applyGrantorSuccession({
    deceased: prepared.deceased,
    entities: prepared.entities,
  });

  // Phase 3 — gross estate (reads pre-chain accounts AND un-mutated
  // entities). Using `prepared.*` here is critical: the 4b precedence chain
  // has already flipped ownership of deceased-owned accounts (e.g.
  // `all_assets → spouse` mutates owner in-place), which would otherwise
  // make computeGrossEstate see `owner !== deceased` and return 0. Mirrors
  // applyFinalDeath's pre-chain-read convention. The PREPARED pre-chain state
  // has faceValue substituted on triggering policies (§2042-equivalent).
  const gross = computeGrossEstate({
    deceased: prepared.deceased,
    deathOrder: 1,
    accounts: prepared.accounts,
    accountBalances: prepared.accountBalances,
    liabilities: prepared.liabilities,
    entities: prepared.entities,
    deceasedFmId,
    survivorFmId,
    entityAccountSharesEoY: input.entityAccountSharesEoY,
    familyAccountSharesEoY: input.familyAccountSharesEoY,
  });

  // Phase 4 — deductions (marital + charitable + admin). Pass the post-chain
  // liabilities so encumbrances that follow assets to the surviving spouse
  // reduce the marital deduction (§2056(b)(4)(B)).
  const deductions = computeDeductions({
    transferLedger: chainResult.transfers,
    grossEstateLines: gross.lines,
    externalBeneficiaries: input.externalBeneficiaries,
    planSettings: input.planSettings,
    deathOrder: 1,
    resultingLiabilities: chainResult.liabilities,
  });

  // Phase 5 — tax computation. Preview first so we know the drain amount,
  // then rebuild after drains with the debits populated. buildEstateTaxResult
  // is pure, so calling it twice is safe.
  //
  // accountValueAtYear: returns the balance at the gift year when per-year
  // snapshots are available; falls back to the death-year balance otherwise.
  const deathYearBalances = chainResult.accountBalances;
  const accountValueAtYear = (accountId: string, year: number): number => {
    const yearMap = input.yearEndAccountBalances?.get(year);
    if (yearMap && yearMap[accountId] != null) return yearMap[accountId];
    // Fallback: death-year balance (preserves current behavior when no per-year history).
    return deathYearBalances[accountId] ?? 0;
  };
  const inPlanCumulative = computeAdjustedTaxableGifts(
    input.deceased,
    input.gifts,
    input.entities,
    input.annualExclusionsByYear,
    accountValueAtYear,
    input.giftEvents ?? [],
  );
  const adjustedGifts = inPlanCumulative + input.priorTaxableGifts[input.deceased];
  const taxInflation =
    input.planSettings.taxInflationRate ?? input.planSettings.inflationRate ?? 0;
  const beaAtDeathYear = beaForYear(input.year, taxInflation);

  const preview = buildEstateTaxResult({
    year: input.year,
    deathOrder: 1,
    deceased: input.deceased,
    gross,
    deductions,
    adjustedTaxableGifts: adjustedGifts,
    lifetimeGiftTaxAdjustment: 0,
    beaAtDeathYear,
    dsueReceived: input.dsueReceived,
    residenceState: input.planSettings.residenceState ?? null,
    stateEstateTaxFallbackRate: input.planSettings.flatStateEstateRate ?? 0,
    estateTaxDebits: [],
    creditorPayoffDebits: [],
    creditorPayoffResidual: 0,
  });

  // Phase 8 — estate-tax drain on non-marital residuary. Marital accounts
  // (those produced by a transfer with recipientKind === "spouse") are
  // excluded so the marital deduction isn't clawed back by the drain.
  const maritalAccountIds = new Set(
    chainResult.transfers
      .filter((t) => t.recipientKind === "spouse" && t.resultingAccountId != null)
      .map((t) => t.resultingAccountId as string),
  );

  const accountBalances = { ...chainResult.accountBalances };
  const estateTaxDrain = drainLiquidAssets({
    amountNeeded: preview.totalTaxesAndExpenses,
    accounts: chainResult.accounts,
    accountBalances,
    eligibilityFilter: (a) => {
      if (maritalAccountIds.has(a.id)) return false;
      // Exclude accounts distributed to a non-principal heir FM
      const cfmA = controllingFamilyMember(a);
      if (cfmA != null && cfmA !== deceasedFmId && cfmA !== survivorFmId) return false;
      const entityId = controllingEntity(a);
      if (entityId != null) {
        const ent = input.entities.find((e) => e.id === entityId);
        if (!ent) return false;
        if (ent.isIrrevocable) return false;
        if (ent.grantor !== input.deceased) return false;
        return true;
      }
      return controllingFamilyMember(a) === deceasedFmId && deceasedFmId != null;
    },
  });

  const warnings = [...chainResult.warnings, ...succession.warnings, ...li.warnings];
  for (const debit of estateTaxDrain.debits) {
    accountBalances[debit.accountId] =
      (accountBalances[debit.accountId] ?? 0) - debit.amount;
    const a = chainResult.accounts.find((x) => x.id === debit.accountId);
    if (a && a.category === "retirement") {
      warnings.push(`retirement_estate_drain: ${a.id}`);
    }
  }
  if (estateTaxDrain.residual > 0) {
    warnings.push(`estate_tax_insufficient_liquid: ${estateTaxDrain.residual.toFixed(2)}`);
  }

  // Phase 9 — apply grantor-succession updates now.
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

  // Phase 10 — pour-out distribution (stubbed; the common empty-queue path
  // is handled inline by runPourOut).
  let ledger = [...chainResult.transfers];
  let pouredLiabs = [...chainResult.liabilities];
  if (succession.pourOutQueue.length > 0) {
    const pourOut = runPourOut({
      queue: succession.pourOutQueue,
      deceased: input.deceased,
      deathOrder: 1,
      accounts: chainResult.accounts,
      accountBalances,
      basisMap: chainResult.basisMap,
      liabilities: pouredLiabs,
      familyMembers: input.familyMembers,
      externalBeneficiaries: input.externalBeneficiaries,
      entities: mutatedEntities,
      year: input.year,
    });
    ledger = ledger.concat(pourOut.transfers);
    pouredLiabs = pourOut.liabilities;
    warnings.push(...pourOut.warnings);
  }

  // Phase 10.5 — distribute deceased's portion of unlinked household debts
  // (credit cards, personal loans, etc.) via the default-order chain (spouse
  // → children → other heirs), independent of how assets routed. Will-liability
  // bequests have already been peeled off by `applyLiabilityBequests`. Without
  // this step the gross estate (which subtracts deceased-owned debts as
  // Schedule K negatives) won't reconcile against the transfer ledger, and the
  // original liability rows would stay owned by the now-deceased FM.
  const unlinkedDist = distributeFirstDeathUnlinkedLiabilities(
    pouredLiabs,
    deceasedFmId,
    survivorFmId,
    input.year,
    input.deceased,
    input.familyMembers,
  );
  ledger = ledger.concat(unlinkedDist.liabilityTransfers);
  pouredLiabs = unlinkedDist.updatedLiabilities;
  warnings.push(...unlinkedDist.warnings);

  // Phase 10.6 — recompute deductions with the post-Phase-10.5 ledger so
  // §2056(b)(4)(B)'s extension to unlinked debts assumed by the surviving
  // spouse takes effect. Phase 4's preview-grade deductions only saw
  // chainResult.transfers, which is missing the `unlinked_liability_proportional`
  // entries that this extension keys off. The drain in Phase 8 still uses the
  // preview-grade value (small under-drain when the extension fires AND there's
  // a federal tax, which is rare and corrected on the next projection year).
  const finalDeductions = computeDeductions({
    transferLedger: ledger,
    grossEstateLines: gross.lines,
    externalBeneficiaries: input.externalBeneficiaries,
    planSettings: input.planSettings,
    deathOrder: 1,
    resultingLiabilities: pouredLiabs,
  });

  // Phase 11 — final EstateTaxResult with drain debits populated.
  const decedentMember = input.familyMembers.find((m) => m.role === input.deceased);
  const decedentAgeAtDeath = decedentMember?.dateOfBirth
    ? input.year - Number(decedentMember.dateOfBirth.slice(0, 4))
    : 0;

  const baseEstateTax = buildEstateTaxResult({
    year: input.year,
    deathOrder: 1,
    deceased: input.deceased,
    gross,
    deductions: finalDeductions,
    adjustedTaxableGifts: adjustedGifts,
    lifetimeGiftTaxAdjustment: 0,
    beaAtDeathYear,
    dsueReceived: input.dsueReceived,
    residenceState: input.planSettings.residenceState ?? null,
    stateEstateTaxFallbackRate: input.planSettings.flatStateEstateRate ?? 0,
    estateTaxDebits: estateTaxDrain.debits,
    creditorPayoffDebits: [],
    creditorPayoffResidual: 0,
    transfersForInheritance: ledger,
    accounts: input.accounts,
    familyMembers: input.familyMembers,
    externalBeneficiaries: input.externalBeneficiaries,
    decedentAgeAtDeath,
  });

  // Phase 11b — drain attribution. The chain ran on pre-drain balances, so
  // `ledger` carries gross transfers. No creditor drain at first death.
  const drainAttributions = attributeDrainsToLedger({
    deathOrder: 1,
    transfers: ledger,
    estateTax: baseEstateTax,
    creditorDrainTotal: 0,
    will: input.will,
    deceased: input.deceased,
  });
  const irdAttributions = computeIrdAttributions({
    deathOrder: 1,
    transfers: ledger,
    accounts: input.accounts,
    externalBeneficiaries: input.externalBeneficiaries,
    irdTaxRate: input.planSettings.irdTaxRate ?? 0,
  });
  const estateTax: EstateTaxResult = {
    ...baseEstateTax,
    drainAttributions: [...drainAttributions, ...irdAttributions],
  };

  assertFirstDeathInvariants(estateTax, mutatedEntities, input.deceased);
  assertPrecedenceChainInvariants({
    transfers: chainResult.transfers,
    accounts: chainResult.accounts,
    incomes: chainResult.incomes,
  }, prepared);

  return {
    accounts: chainResult.accounts,
    accountBalances,
    basisMap: chainResult.basisMap,
    incomes: chainResult.incomes,
    liabilities: pouredLiabs,
    transfers: ledger,
    warnings,
    estateTax,
    dsueGenerated: estateTax.dsueGenerated,
    entities: mutatedEntities,
  };
}

/** Post-event invariant checks on the 4b-era precedence chain output.
 *  Carried over from the pre-4d body. Violations indicate a routing bug. */
function assertPrecedenceChainInvariants(
  chain: { transfers: DeathTransfer[]; accounts: Account[]; incomes: Income[] },
  input: DeathEventInput,
): void {
  const deceasedFmId = input.familyMembers.find((fm) => fm.role === input.deceased)?.id ?? null;
  // 1. Sum of ledger amounts grouped by source = each source's pre-death value
  //    (skip liability-only transfers which have null sourceAccountId)
  const bySource = new Map<string, number>();
  for (const t of chain.transfers) {
    if (t.sourceAccountId == null) continue;
    bySource.set(t.sourceAccountId, (bySource.get(t.sourceAccountId) ?? 0) + t.amount);
  }
  for (const [sourceId, summed] of bySource.entries()) {
    const originalBalance = input.accountBalances[sourceId];
    if (originalBalance == null) continue;
    if (Math.abs(summed - originalBalance) > 0.01) {
      throw new Error(
        `applyFirstDeath invariant: ledger sum for ${sourceId} = ${summed}, expected ${originalBalance}`,
      );
    }
  }
  // 2. No deceased-owner orphan accounts (sole FM owner = deceased, not entity-owned)
  for (const a of chain.accounts) {
    if (
      !isFullyEntityOwned(a) &&
      deceasedFmId != null &&
      controllingFamilyMember(a) === deceasedFmId
    ) {
      throw new Error(
        `applyFirstDeath invariant: account ${a.id} still has deceased as sole owner`,
      );
    }
  }
  // 3. No personal (non-entity) deceased-owner incomes active after deathYear
  for (const inc of chain.incomes) {
    if (
      !inc.ownerEntityId &&
      inc.owner === input.deceased &&
      inc.endYear > input.year
    ) {
      throw new Error(
        `applyFirstDeath invariant: income ${inc.id} still active after death year`,
      );
    }
  }
}

/** 4d-specific invariants on the estate-tax result + post-succession entity state. */
function assertFirstDeathInvariants(
  estateTax: EstateTaxResult,
  entities: EntitySummary[],
  deceased: "client" | "spouse",
): void {
  // grossEstate can be negative when the deceased owns no individual assets
  // but proportional household-debt attribution lands on them (4d-2 hypothetical
  // ordering exposes this; real-death flows never hit it). taxableEstate is
  // clamped to 0 downstream, so the math stays correct — only relax the guard.
  if (estateTax.taxableEstate < 0) throw new Error("first-death: taxable estate negative");
  if (estateTax.federalEstateTax < 0) throw new Error("first-death: federal tax negative");
  if (estateTax.stateEstateTax < 0) throw new Error("first-death: state tax negative");
  if (estateTax.dsueGenerated < 0) throw new Error("first-death: dsue negative");
  if (estateTax.applicableExclusion !== estateTax.beaAtDeathYear + estateTax.dsueReceived) {
    throw new Error("first-death: applicableExclusion drift");
  }
  for (const e of entities) {
    if (e.isIrrevocable && e.isGrantor && e.grantor === deceased) {
      throw new Error(`first-death: post-event entity ${e.id} still grantor-flipped for deceased`);
    }
    if (!e.isIrrevocable && e.grantor === deceased) {
      throw new Error(`first-death: revocable entity ${e.id} grantor=deceased was not flipped`);
    }
  }

  assertDrainAttributionsReconcile(estateTax, "first-death:");
}

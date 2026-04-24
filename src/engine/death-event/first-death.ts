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
    const touchedByDeceased =
      acct.owner === deceased || acct.owner === "joint";
    if (!touchedByDeceased || acct.ownerEntityId || acct.ownerFamilyMemberId) {
      nextAccounts.push(acct);
      continue;
    }

    // Collect the linked liability (if any) — we'll replace it on the
    // accumulator list once we know what the account split becomes.
    const linkedLiability = liabilities.find((l) => l.linkedPropertyId === acct.id);

    // Build an adjusted copy that carries the current (grown) balance and basis.
    // workingAccounts[i].value is a snapshot from plan-start and never updated
    // year-over-year; the authoritative grown value lives in accountBalances[id].
    const balance = accountBalances[acct.id];
    const basis = basisMap[acct.id];
    if (balance == null || basis == null) {
      throw new Error(
        `applyFirstDeath: missing accountBalances/basisMap entry for ${acct.id}`,
      );
    }
    const effectiveAcct: Account = { ...acct, value: balance, basis };

    // Track remaining undisposed fraction for this account.
    let undisposed = acct.owner === "joint" ? 1 : 1; // either way, the account goes through steps
    let anySpecificClauseTouched = false;
    const stepAccts: Account[] = [];
    const stepLiabs: Liability[] = [];
    const stepLedger: Array<Omit<DeathTransfer, "year" | "deceased" | "deathOrder">> = [];

    // Step 1: Titling
    const step1 = applyTitling(effectiveAcct, survivor, linkedLiability);
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
        familyMembers, externalBeneficiaries, linkedLiability,
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
        effectiveAcct, undisposed, deceasedWill, 1, survivor,
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
        effectiveAcct, undisposed, anySpecificClauseTouched, deceasedWill, 1, survivor,
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
        effectiveAcct, undisposed, survivor, familyMembers, linkedLiability,
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
  // Phase 1 — 4b precedence chain. Capture its transfer ledger + state.
  const chainResult = runFirstDeathPrecedenceChain(input);

  // Phase 2 — compute grantor-succession updates (not yet applied).
  const succession = applyGrantorSuccession({
    deceased: input.deceased,
    entities: input.entities,
  });

  // Phase 3 — gross estate (reads pre-chain accounts AND un-mutated
  // entities). Using `input.*` here is critical: the 4b precedence chain
  // has already flipped ownership of deceased-owned accounts (e.g.
  // `all_assets → spouse` mutates owner in-place), which would otherwise
  // make computeGrossEstate see `owner !== deceased` and return 0. Mirrors
  // applyFinalDeath's pre-chain-read convention.
  const gross = computeGrossEstate({
    deceased: input.deceased,
    deathOrder: 1,
    accounts: input.accounts,
    accountBalances: input.accountBalances,
    liabilities: input.liabilities,
    entities: input.entities,
  });

  // Phase 4 — deductions (marital + charitable + admin).
  const deductions = computeDeductions({
    transferLedger: chainResult.transfers,
    externalBeneficiaries: input.externalBeneficiaries,
    planSettings: input.planSettings,
    deathOrder: 1,
  });

  // Phase 5 — tax computation. Preview first so we know the drain amount,
  // then rebuild after drains with the debits populated. buildEstateTaxResult
  // is pure, so calling it twice is safe.
  const adjustedGifts = computeAdjustedTaxableGifts(
    input.deceased,
    input.gifts,
    input.entities,
    input.annualExclusionsByYear,
  );
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
    stateEstateTaxRate: input.planSettings.flatStateEstateRate ?? 0,
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

  const warnings = [...chainResult.warnings, ...succession.warnings];
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

  // Phase 11 — final EstateTaxResult with drain debits populated.
  const estateTax = buildEstateTaxResult({
    year: input.year,
    deathOrder: 1,
    deceased: input.deceased,
    gross,
    deductions,
    adjustedTaxableGifts: adjustedGifts,
    lifetimeGiftTaxAdjustment: 0,
    beaAtDeathYear,
    dsueReceived: input.dsueReceived,
    stateEstateTaxRate: input.planSettings.flatStateEstateRate ?? 0,
    estateTaxDebits: estateTaxDrain.debits,
    creditorPayoffDebits: [],
    creditorPayoffResidual: 0,
  });

  assertFirstDeathInvariants(estateTax, mutatedEntities, input.deceased);
  assertPrecedenceChainInvariants({
    transfers: chainResult.transfers,
    accounts: chainResult.accounts,
    incomes: chainResult.incomes,
  }, input);

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
  };
}

/** Post-event invariant checks on the 4b-era precedence chain output.
 *  Carried over from the pre-4d body. Violations indicate a routing bug. */
function assertPrecedenceChainInvariants(
  chain: { transfers: DeathTransfer[]; accounts: Account[]; incomes: Income[] },
  input: DeathEventInput,
): void {
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
  // 2. No deceased-owner orphan accounts (no entity/family-member tag, owner = deceased)
  for (const a of chain.accounts) {
    if (
      a.owner === input.deceased &&
      !a.ownerEntityId &&
      !a.ownerFamilyMemberId
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
}

import type {
  Account, Liability, DeathTransfer, Will,
} from "../types";
import {
  applyBeneficiaryDesignations,
  applyFallback,
  applyIncomeTermination,
  applyWillAllAssetsResidual,
  applyWillSpecificBequests,
  distributeUnlinkedLiabilities,
  type DeathEventInput,
  type DeathEventResult,
} from "./shared";

/** 4c orchestrator — final-death asset transfer. Runs the precedence chain
 *  (step 1 titling is inert; step 2 designations; step 3 will with
 *  deathOrder=2 condition filter; step 4 fallback with survivor=null so
 *  tier 1 is skipped and tiers 2/3 handle the residual), distributes
 *  unlinked household liabilities proportionally to final-tier recipients,
 *  terminates the deceased's personal income streams, and asserts
 *  4c-specific invariants. */
export function applyFinalDeath(input: DeathEventInput): DeathEventResult {
  const {
    year, deceased, will,
    accounts, accountBalances, basisMap,
    incomes, liabilities,
    familyMembers, externalBeneficiaries, entities,
  } = input;

  // Defensive: no joint accounts can exist at 4c.
  for (const a of accounts) {
    if (a.owner === "joint") {
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

  // Unlinked household liability distribution (Feature A).
  const unlinkedResult = distributeUnlinkedLiabilities(
    nextLiabilities, assetTransfers, year, deceased,
  );
  const allTransfers = [...assetTransfers, ...unlinkedResult.liabilityTransfers];
  warnings.push(...unlinkedResult.warnings);

  // Income termination — reuse the 4b helper. At 4c there are no joint
  // accounts to retitle; the survivor arg to the helper is only used for
  // joint-income retitling and doesn't matter here, so we pass deceased.
  const nextIncomes = applyIncomeTermination(incomes, deceased, deceased, year);

  const result: DeathEventResult = {
    accounts: nextAccounts,
    accountBalances: nextAccountBalances,
    basisMap: nextBasisMap,
    incomes: nextIncomes,
    liabilities: unlinkedResult.updatedLiabilities,
    transfers: allTransfers,
    warnings,
  };

  assertFinalDeathInvariants(result, input);

  return result;
}

function assertFinalDeathInvariants(result: DeathEventResult, input: DeathEventInput): void {
  // 1. No transfer has recipientKind === "spouse" — tier 1 is skipped at 4c,
  //    and a will/designation routing to the deceased's already-deceased spouse
  //    is bad data. Check this first so the error is maximally informative.
  for (const t of result.transfers) {
    if (t.recipientKind === "spouse") {
      throw new Error(
        `applyFinalDeath invariant: transfer for ${t.sourceAccountId ?? t.sourceLiabilityId} routes to spouse at final death`,
      );
    }
  }

  // 2. Sum of asset transfer amounts grouped by source = each source's pre-death balance.
  const bySource = new Map<string, number>();
  for (const t of result.transfers) {
    if (t.sourceAccountId == null) continue;  // skip liability transfers
    bySource.set(t.sourceAccountId, (bySource.get(t.sourceAccountId) ?? 0) + t.amount);
  }
  for (const [sourceId, summed] of bySource.entries()) {
    const originalBalance = input.accountBalances[sourceId];
    if (originalBalance == null) continue;
    if (Math.abs(summed - originalBalance) > 0.01) {
      throw new Error(
        `applyFinalDeath invariant: asset ledger sum for ${sourceId} = ${summed}, expected ${originalBalance}`,
      );
    }
  }

  // 3. Sum of liability transfer amounts grouped by source = -(liability balance).
  const byLiability = new Map<string, number>();
  for (const t of result.transfers) {
    if (t.sourceLiabilityId == null) continue;
    byLiability.set(
      t.sourceLiabilityId,
      (byLiability.get(t.sourceLiabilityId) ?? 0) + t.amount,
    );
  }
  for (const [liabId, summed] of byLiability.entries()) {
    const liab = input.liabilities.find((l) => l.id === liabId);
    if (!liab) continue;
    if (Math.abs(-summed - liab.balance) > 0.01) {
      throw new Error(
        `applyFinalDeath invariant: liability ledger sum for ${liabId} = ${summed}, expected ${-liab.balance}`,
      );
    }
  }

  // 4. No deceased-owner orphan accounts remain.
  for (const a of result.accounts) {
    if (
      a.owner === input.deceased &&
      !a.ownerEntityId &&
      !a.ownerFamilyMemberId
    ) {
      throw new Error(
        `applyFinalDeath invariant: account ${a.id} still has deceased as sole owner`,
      );
    }
  }

  // 5. No account remains with owner='joint' (should have been caught up-front).
  for (const a of result.accounts) {
    if (a.owner === "joint") {
      throw new Error(
        `applyFinalDeath invariant: account ${a.id} owner='joint' after event`,
      );
    }
  }

  // 6. No personal (non-entity) deceased-owner incomes active past deathYear.
  for (const inc of result.incomes) {
    if (
      !inc.ownerEntityId &&
      inc.owner === input.deceased &&
      inc.endYear > input.year
    ) {
      throw new Error(
        `applyFinalDeath invariant: income ${inc.id} still active after final-death year`,
      );
    }
  }
}

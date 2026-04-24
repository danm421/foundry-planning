import type {
  Account, Liability, DeathTransfer, Will,
} from "../types";
import {
  applyBeneficiaryDesignations,
  applyFallback,
  applyIncomeTermination,
  applyTitling,
  applyWillAllAssetsResidual,
  applyWillSpecificBequests,
  type DeathEventInput,
  type DeathEventResult,
} from "./shared";

/** Orchestrator. Applies the precedence chain (titling → bene-designations →
 *  will → fallback) to every account touched by the deceased, and clips the
 *  deceased's personal income streams. Returns fully-updated engine state +
 *  a transfer ledger + any warnings. */
export function applyFirstDeath(input: DeathEventInput): DeathEventResult {
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

  const result: DeathEventResult = {
    accounts: nextAccounts,
    accountBalances: nextAccountBalances,
    basisMap: nextBasisMap,
    incomes: nextIncomes,
    liabilities: nextLiabilities,
    transfers,
    warnings,
  };

  assertInvariants(result, input);

  return result;
}

/** Post-event invariant checks. Violations indicate a routing bug. */
function assertInvariants(result: DeathEventResult, input: DeathEventInput): void {
  // 1. Sum of ledger amounts grouped by source = each source's pre-death value
  //    (skip liability-only transfers which have null sourceAccountId)
  const bySource = new Map<string, number>();
  for (const t of result.transfers) {
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
  for (const a of result.accounts) {
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
  for (const inc of result.incomes) {
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

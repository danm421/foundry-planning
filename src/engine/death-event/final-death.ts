import type {
  Account, Liability, DeathTransfer, Will, Income, EntitySummary,
  EstateTaxResult,
} from "../types";
import {
  applyBeneficiaryDesignations,
  applyFallback,
  applyIncomeTermination,
  applyWillAllAssetsResidual,
  applyWillResiduary,
  applyWillSpecificBequests,
  computeSteppedUpBasis,
  distributeUnlinkedLiabilities,
  partitionMixedAccount,
  selectResiduaryTier,
  runPourOut,
  type DeathEventInput,
  type DeathEventResult,
} from "./shared";
import { controllingEntity, isFullyEntityOwned, ownedByHousehold, controllingFamilyMember } from "../ownership";
import {
  buildEstateTaxResult,
  computeDeductions,
  computeGrossEstate,
  computeProbateEstate,
} from "./estate-tax";
import { applyGrantorSuccession } from "./grantor-succession";
import {
  applyBusinessBasisUpdates,
  applyBusinessOwnerSuccession,
  applyBusinessSuccession,
} from "./business-succession";
import { drainLiquidAssets } from "./creditor-payoff";
import { prepareLifeInsurancePayouts } from "./life-insurance-payout";
import { computeSection2035Lookback } from "./section-2035-lookback";
import { applyLiabilityBequests } from "./liability-bequests";
import {
  assertDrainAttributionsReconcile,
  attributeDrainsToLedger,
} from "./drain-attribution";
import { computeIrdAttributions, hasUntaxedInheritedIrd } from "./ird-tax";
import { beaForYear } from "@/lib/tax/estate";
import { computeAdjustedTaxableGiftsByYear } from "@/lib/estate/adjusted-taxable-gifts";

interface FinalDeathChainResult {
  accounts: Account[];
  accountBalances: Record<string, number>;
  basisMap: Record<string, number>;
  incomes: Income[];
  liabilities: Liability[];
  transfers: DeathTransfer[];
  warnings: string[];
  /** Single source of truth for the residuary tier governing this final
   *  death — computed ONCE here from predeceasedFmId. Both the chain's
   *  step-3c distribution and the orchestrator's drain-attribution call
   *  read this, so estate distribution and drain attribution can never
   *  desync (plan HARD INVARIANT). */
  residuaryTier: "primary" | "contingent";
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

  // Resolve household principal FM ids for ownership comparisons.
  const deceasedFmId = familyMembers.find((fm) => fm.role === deceased)?.id ?? null;
  // At final death the other principal predeceased this event. Designations
  // naming that person lapse — alongside those naming the decedent.
  const predeceasedRole = deceased === "client" ? "spouse" : "client";
  const predeceasedFmId =
    familyMembers.find((fm) => fm.role === predeceasedRole)?.id ?? null;
  // Single source of truth for the residuary tier at this final death. A
  // non-null predeceasedFmId means a spouse principal existed → household
  // was married → contingent tier. Computed ONCE here; consumed by step 3c
  // below AND by the orchestrator's drain-attribution call (via the result).
  const residuaryTier = selectResiduaryTier(2, predeceasedFmId != null);

  // Defensive: no joint accounts can exist at 4c. Entity/family-member-owned
  // (ownerFamilyMemberId heir-distribution) accounts are exempt. Mixed
  // family+entity accounts (e.g. client 80% + LLC 20%) are also NOT joint —
  // they'll be partitioned in the loop below — so exclude them from this guard.
  for (const a of accounts) {
    const cfm = controllingFamilyMember(a);
    const hasMixedEntityFm =
      a.owners.some((o) => o.kind === "entity") &&
      a.owners.some((o) => o.kind === "family_member");
    const isJoint =
      ownedByHousehold(a) > 0.0001 && cfm == null && !isFullyEntityOwned(a) && !hasMixedEntityFm;
    if (isJoint) {
      throw new Error(
        `applyFinalDeath invariant: account ${a.id} still has joint ownership at final death (should have been retitled at 4b)`,
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
    // Top-level business accounts: see first-death.ts for the same carve-
    // out — applyBusinessSuccession owns the consolidated transfer.
    if (
      acct.category === "business" &&
      acct.parentAccountId == null &&
      deceasedFmId != null
    ) {
      nextAccounts.push(acct);
      continue;
    }

    const cfm = controllingFamilyMember(acct);
    // Mixed family+entity account: controllingFamilyMember returns null whenever
    // any entity owner is present (by design — no sole controlling FM). Guard
    // must also catch the case where the deceased FM owns a slice alongside an
    // entity, otherwise the partition block below is unreachable for this common
    // scenario.
    const isMixedDeceased =
      acct.owners.some((o) => o.kind === "entity") &&
      acct.owners.some(
        (o) => o.kind === "family_member" && o.familyMemberId === deceasedFmId,
      );
    const touchedByDeceased =
      (cfm === deceasedFmId && deceasedFmId != null) || isMixedDeceased;
    // isHeirOwned: sole FM owner is not a household principal (already distributed to an heir FM)
    const isHeirOwned = cfm != null && cfm !== deceasedFmId;
    if (!touchedByDeceased || isFullyEntityOwned(acct) || isHeirOwned) {
      nextAccounts.push(acct);
      continue;
    }

    const linkedLiability = liabilities.find((l) => l.linkedPropertyId === acct.id);

    const balance = accountBalances[acct.id];
    const originalBasis = basisMap[acct.id];
    if (balance == null || originalBasis == null) {
      throw new Error(
        `applyFinalDeath: missing accountBalances/basisMap entry for ${acct.id}`,
      );
    }

    // Mixed family+entity account: peel off entity slices (retained,
    // unchanged) and route only the family pool. Without this the chain
    // treats the account as joint and sweeps the entity's slice into the
    // transfer — double-counting it against the consolidated business line.
    let routedAcct = acct;
    let routedBalance = balance;
    let routedBasis = originalBasis;
    const hasEntityOwner = acct.owners.some((o) => o.kind === "entity");
    const hasFamilyOwner = acct.owners.some((o) => o.kind === "family_member");
    if (hasEntityOwner && hasFamilyOwner) {
      const part = partitionMixedAccount(
        acct, balance, originalBasis, input.entityAccountSharesEoY,
      );
      for (const slice of part.entitySlices) {
        nextAccounts.push(slice);
        nextAccountBalances[slice.id] = slice.value;
        nextBasisMap[slice.id] = slice.basis;
      }
      routedAcct = part.familyPool;
      routedBalance = part.familyPool.value;
      routedBasis = part.familyPool.basis;
    }

    // §1014 step-up. No joint accounts survive into final-death (first-
    // death titling consumed them), so isJointAtFirstDeath is always false.
    // titlingType is a no-op when isJointAtFirstDeath is false, but the
    // helper signature requires it — pass through the account's value.
    const steppedBasis = computeSteppedUpBasis(
      routedAcct.category, routedBalance, routedBasis,
      { isJointAtFirstDeath: false, titlingType: routedAcct.titlingType },
    );
    const effectiveAcct: Account = { ...routedAcct, value: routedBalance, basis: steppedBasis };

    let undisposed = 1;
    let anySpecificClauseTouched = false;
    const stepAccts: Account[] = [];
    const stepLiabs: Liability[] = [];
    const stepLedger: Array<Omit<DeathTransfer, "year" | "deceased" | "deathOrder">> = [];

    // Step 1 is a no-op at 4c (no joint accounts). Skip directly to step 2.

    // Step 2: Beneficiary designations
    const step2 = applyBeneficiaryDesignations(
      effectiveAcct, undisposed,
      familyMembers, externalBeneficiaries, entities, linkedLiability,
      deceasedFmId, /* survivorFmId */ null, predeceasedFmId,
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
        effectiveAcct, undisposed, deceasedWill, 2, null, null,
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
        effectiveAcct, undisposed, anySpecificClauseTouched, deceasedWill, 2, null, null,
        familyMembers, externalBeneficiaries, entities, linkedLiability,
      );
      if (step3b.fractionClaimed > 0) {
        stepAccts.push(...step3b.resultingAccounts);
        stepLiabs.push(...step3b.resultingLiabilities);
        stepLedger.push(...step3b.ledgerEntries);
        undisposed -= step3b.fractionClaimed;
      }
    }

    // Step 3c: residuary clause (deathOrder=2). Uses the single `residuaryTier`
    // computed once above — contingent unless the household was never married.
    if (undisposed > 1e-9 && deceasedWill) {
      const step3c = applyWillResiduary(
        effectiveAcct,
        undisposed,
        deceasedWill,
        residuaryTier,
        null,
        null,
        familyMembers,
        externalBeneficiaries,
        entities,
        linkedLiability,
      );
      if (step3c.fractionClaimed > 0) {
        stepAccts.push(...step3c.resultingAccounts);
        stepLiabs.push(...step3c.resultingLiabilities);
        stepLedger.push(...step3c.ledgerEntries);
        undisposed -= step3c.fractionClaimed;
      }
    }

    // Step 4: Fallback with survivor=null — tier 1 skipped; tiers 2/3 live.
    if (undisposed > 1e-9) {
      const step4 = applyFallback(
        effectiveAcct, undisposed, null, null, familyMembers, linkedLiability,
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
    residuaryTier,
  };
}

/** 4d-1 orchestrator — final-death with pipeline inversion. Creditor-payoff
 *  and estate-tax drains debit accounts BEFORE the 4c precedence chain
 *  distributes the residual. Trust pour-outs fold in as a preceding step to
 *  the chain. Residual unlinked debt falls back to the old proportional-
 *  distribution helper post-chain. */
export function applyFinalDeath(input: DeathEventInput): DeathEventResult {
  const warnings: string[] = [];

  // Resolve household principal FM ids for ownership comparisons in drains.
  const deceasedFmId =
    input.familyMembers.find((fm) => fm.role === input.deceased)?.id ?? null;

  // Phase 0 — life-insurance pre-chain transform. Triggering policies have
  // their cash value swapped for faceValue and are reclassified as cash, so
  // the chain routes them via per-account beneficiaries / will / fallback
  // naturally. computeGrossEstate then picks up faceValue via the existing
  // owner / grantor-revocable rules (§2042-equivalent). Joint-insured policies
  // fire at final death via eventKind: "final_death".
  const li = prepareLifeInsurancePayouts({
    year: input.year,
    deceased: input.deceased,
    eventKind: "final_death",
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

  // Phase 2 — compute grantor-succession updates (not yet applied). Defer
  // application until after gross-estate + drains read pre-flip state.
  const succession = applyGrantorSuccession({
    deceased: prepared.deceased,
    deathYear: input.year,
    entities: prepared.entities,
  });
  warnings.push(...succession.warnings);
  warnings.push(...li.warnings);

  // Phase 3 — gross estate (pre-drain, pre-mutate). Uses PREPARED pre-chain
  // state so faceValue is included for triggering policies (§2042-equivalent).
  const gross = computeGrossEstate({
    deceased: prepared.deceased,
    deathOrder: 2,
    accounts: prepared.accounts,
    accountBalances: prepared.accountBalances,
    liabilities: prepared.liabilities,
    entities: prepared.entities,
    deceasedFmId,
    survivorFmId: null, // no survivor at final death
    entityAccountSharesEoY: input.entityAccountSharesEoY,
    familyAccountSharesEoY: input.familyAccountSharesEoY,
    // Gift-aware ownership: assets gifted out of the household before death
    // leave the gross estate (and aren't double-counted vs adjusted taxable
    // gifts). Trust gifts shift to the entity inclusion rules.
    giftEvents: input.giftEvents ?? [],
    deathYear: input.year,
    planStartYear: input.planSettings.planStartYear,
  });

  // Phase 3.1 — §2035 three-year lookback for life-insurance policies
  // gifted to irrevocable trusts (ILITs). When the deceased gifted a policy
  // on their own life within 3 years of death, the face value pulls back
  // into the gross estate. The reversal of the prior gift-value contribution
  // to adjusted taxable gifts happens in Phase 5 (below) by filtering the
  // §2035-pulled asset gifts out of the giftEvents passed to
  // computeAdjustedTaxableGifts.
  //
  // IMPORTANT: read from `input.accounts` (pre-Phase-0), not `prepared.accounts`.
  // Phase 0 transforms triggering policies into `taxable`/`life_insurance_proceeds`
  // accounts and strips the `lifeInsurance` block — but the helper needs to
  // match on `category === "life_insurance"` and read `lifeInsurance.faceValue`
  // to identify the policy and its face value.
  const section2035 = computeSection2035Lookback({
    deceased: prepared.deceased,
    deathYear: input.year,
    giftEvents: input.giftEvents ?? [],
    accounts: input.accounts,
    entities: prepared.entities,
  });
  if (section2035.addBackLines.length > 0) {
    gross.lines.push(...section2035.addBackLines);
    gross.total += section2035.addBackLines.reduce((s, l) => s + l.amount, 0);
  }

  // Probate cost (§2053): a rate applied to the probate estate — the subset of
  // the gross estate that passes through the will. At final death formerly-joint
  // property is solely owned, so the probate base typically widens.
  const probateCostRate = input.planSettings.probateCostRate ?? 0;
  const probateEstate = computeProbateEstate({
    gross,
    accounts: input.accounts,
    deathOrder: 2,
  });

  // Phase 3.5 — business-interest succession (compute-only; reads pre-flip
  // entities AND pre-chain accounts/accountBalances, same discipline as
  // grantor-succession above). At final death survivorFmId is null — the
  // fallback will route to children → other heirs.
  const businessSuccession = applyBusinessSuccession({
    deceased: prepared.deceased,
    deceasedFmId,
    survivorFmId: null,
    deathOrder: 2,
    accounts: prepared.accounts,
    accountBalances: prepared.accountBalances,
    basisMap: prepared.basisMap,
    will: input.will ?? null,
    familyMembers: input.familyMembers,
    externalBeneficiaries: input.externalBeneficiaries,
    year: input.year,
  });
  warnings.push(...businessSuccession.warnings);

  // Working state for the drain passes.
  //
  // Pipeline split (Phase B): the chain routes accounts at GROSS values, so
  // `accountBalances` is never mutated by drains. A separate `drainTargetBalances`
  // copy IS mutated sequentially by both drains so the second drain sees the
  // residual of the first (preventing double-allocation in the debit arrays).
  // At second death, simulation ends — the chain's "after" doesn't power
  // anything downstream, so the cost of routing gross is one extra balance map
  // and the gain is gross DeathTransfer.amount + per-recipient drain attribution.
  const accountBalances = { ...prepared.accountBalances };
  const drainTargetBalances = { ...prepared.accountBalances };
  let workingLiabs = [...prepared.liabilities];
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
  // Exclude liabilities already transferred to a specific owner (heir FM or
  // entity) via a will-liability bequest — those are no longer unlinked debt.
  const unlinkedDebt = workingLiabs
    .filter(
      (l) =>
        l.linkedPropertyId == null &&
        !l.ownerFamilyMemberId &&
        controllingEntity(l) == null,
    )
    .reduce((sum, l) => sum + l.balance, 0);

  const creditorDrain = drainLiquidAssets({
    amountNeeded: unlinkedDebt,
    accounts: prepared.accounts,
    accountBalances: drainTargetBalances,
    eligibilityFilter: (a) => {
      // Exclude accounts already distributed to a non-principal heir FM
      const cfmA = controllingFamilyMember(a);
      if (cfmA != null && cfmA !== deceasedFmId) return false;
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

  // Apply to drainTargetBalances only — chain/pour-out continue to see gross.
  for (const debit of creditorDrain.debits) {
    drainTargetBalances[debit.accountId] = (drainTargetBalances[debit.accountId] ?? 0) - debit.amount;
    const a = prepared.accounts.find((x) => x.id === debit.accountId);
    if (a && a.category === "retirement") warnings.push(`retirement_estate_drain: ${a.id}`);
  }

  // Reduce each unlinked liability by the drain ratio so the residual (if
  // any) flows to Phase 8's proportional-distribution fallback.
  if (unlinkedDebt > 0) {
    const ratio = creditorDrain.drainedTotal / unlinkedDebt;
    workingLiabs = workingLiabs.map((l) => {
      // Skip linked-property debt, heir-distributed liabilities, and entity-owned
      // (will-bequest-transferred) liabilities — these are not in the drain pool.
      if (l.linkedPropertyId || l.ownerFamilyMemberId || controllingEntity(l) != null) return l;
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

  // accountValueAtYear: returns the balance at the gift year when per-year
  // snapshots are available; falls back to the death-year balance otherwise.
  // Use post-creditor-drain balances (the value still associated with the
  // deceased before the estate-tax drain) — matches Phase A behavior so
  // adjusted-taxable-gifts doesn't shift.
  const finalDeathBalances = drainTargetBalances;
  const accountValueAtYear = (accountId: string, year: number): number => {
    const yearMap = input.yearEndAccountBalances?.get(year);
    if (yearMap && yearMap[accountId] != null) return yearMap[accountId];
    // Fallback: death-year balance (preserves current behavior when no per-year history).
    return finalDeathBalances[accountId] ?? 0;
  };
  // §2035 reversal: exclude asset-gift events for policies pulled back into
  // the gross estate. Without this we'd double-tax — the gift-year value
  // would still consume lifetime exemption AND the face value would be in
  // the gross estate. The cash-only `gifts` list is unaffected (§2035 only
  // applies to gifted policies, which are asset events).
  const giftedPolicyIds = new Set(
    section2035.addBackLines
      .map((l) => l.accountId)
      .filter((id): id is string => id != null),
  );
  const giftEventsForAtg = giftedPolicyIds.size === 0
    ? (input.giftEvents ?? [])
    : (input.giftEvents ?? []).filter(
        (ev) =>
          !(
            ev.kind === "asset" &&
            ev.grantor === input.deceased &&
            giftedPolicyIds.has(ev.accountId)
          ),
      );
  // Per-gift-year breakdown so finite-window state gift-addback rules (ME/VT/MN/NY) can
  // include only gifts within their statutory lookback. The pre-plan `priorTaxableGifts`
  // lump has no per-gift year; it is historical, so it stays in the federal scalar but is
  // outside any finite state window.
  const adjustedGiftsByYear = computeAdjustedTaxableGiftsByYear(
    input.deceased,
    input.gifts,
    input.entities,
    input.annualExclusionsByYear,
    accountValueAtYear,
    giftEventsForAtg,
    input.externalBeneficiaries
      .filter((e) => e.kind != null)
      .map((e) => ({ id: e.id, kind: e.kind! })),
  );
  const inPlanCumulative = adjustedGiftsByYear.reduce((sum, g) => sum + g.amount, 0);
  const adjustedGifts = inPlanCumulative + input.priorTaxableGifts[input.deceased];
  const taxInflation =
    input.planSettings.taxInflationRate ?? input.planSettings.inflationRate ?? 0;
  const beaAtDeathYear = beaForYear(input.year, taxInflation, input.planSettings.lifetimeExemptionCap);

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
    adjustedTaxableGiftsByYear: adjustedGiftsByYear,
    beaAtDeathYear,
    dsueReceived: input.dsueReceived,
    probateCostRate,
    probateEstate,
    residenceState: input.planSettings.residenceState ?? null,
    stateEstateTaxFallbackRate: input.planSettings.flatStateEstateRate ?? 0,
    inflationRate: taxInflation,
    estateTaxDebits: [],
    creditorPayoffDebits: creditorDrain.debits,
    creditorPayoffResidual: creditorDrain.residual,
  });

  // Phase 6 — estate-tax drain on deceased's + grantor-trust liquid assets.
  // Operates on `drainTargetBalances` (post-creditor) so the two drain debit
  // arrays don't double-allocate the same dollars. The chain still sees gross.
  const estateTaxDrain = drainLiquidAssets({
    amountNeeded: previewResult.totalTaxesAndExpenses,
    accounts: prepared.accounts,
    accountBalances: drainTargetBalances,
    eligibilityFilter: (a) => {
      // Exclude accounts already distributed to a non-principal heir FM
      const cfmA = controllingFamilyMember(a);
      if (cfmA != null && cfmA !== deceasedFmId) return false;
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

  for (const debit of estateTaxDrain.debits) {
    drainTargetBalances[debit.accountId] = (drainTargetBalances[debit.accountId] ?? 0) - debit.amount;
    const a = prepared.accounts.find((x) => x.id === debit.accountId);
    if (a && a.category === "retirement") warnings.push(`retirement_estate_drain: ${a.id}`);
  }
  if (estateTaxDrain.residual > 0) {
    warnings.push(`estate_tax_insufficient_liquid: ${estateTaxDrain.residual.toFixed(2)}`);
  }

  // Phase 7 — apply grantor-succession updates. businessSuccession.ownerUpdates
  // / basisUpdates are account-keyed under the account-based business model;
  // wiring them through to accounts is deferred future work — the entity-keyed
  // application that used to live here was inert (find never matched).
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
      accounts: prepared.accounts,
      accountBalances,
      basisMap: input.basisMap,
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
    ...prepared,
    accounts: prepared.accounts,
    accountBalances,
    liabilities: workingLiabs,
    entities: mutatedEntities,
  });
  ledger = ledger.concat(chainResult.transfers);
  workingLiabs = chainResult.liabilities;
  warnings.push(...chainResult.warnings);

  // The 4c chain skips top-level business accounts (handled exclusively by
  // applyBusinessSuccession). Apply the recorded ownerUpdates / basisUpdates
  // so the post-event accounts state reflects the deceased's share moving
  // to its resolved successor FM(s) plus the §1014 step-up.
  const accountsAfterBiz = applyBusinessOwnerSuccession(
    chainResult.accounts, businessSuccession.ownerUpdates,
  );
  const basisMapAfterBiz = applyBusinessBasisUpdates(
    chainResult.basisMap, businessSuccession.basisUpdates,
  );

  // Phase 8c — residual unlinked-debt distribution. Fires only if the
  // creditor-payoff drain couldn't cover everything (e.g., illiquid estate).
  // Routes via default order (children → other heirs); no surviving spouse at
  // final death.
  if (creditorDrain.residual > 0) {
    const residualDist = distributeUnlinkedLiabilities(
      workingLiabs,
      input.year,
      input.deceased,
      input.familyMembers,
    );
    ledger = ledger.concat(residualDist.liabilityTransfers);
    workingLiabs = residualDist.updatedLiabilities;
    warnings.push(...residualDist.warnings);
  }

  // Phase 8.55 — append business-interest transfers so they are visible to the
  // finalDeductions recompute (charitable computation) and inheritance-tax /
  // estate-transfer-detail downstream consumers. No marital deduction at final
  // death, but the transfers must still appear on the ledger.
  ledger = ledger.concat(businessSuccession.transfers);

  // Phase 9 — final deductions (charitable now derivable from ledger).
  const finalDeductions = computeDeductions({
    transferLedger: ledger,
    externalBeneficiaries: input.externalBeneficiaries,
    planSettings: input.planSettings,
    deathOrder: 2,
  });

  const decedentMember = input.familyMembers.find((m) => m.role === input.deceased);
  const decedentAgeAtDeath = decedentMember?.dateOfBirth
    ? input.year - Number(decedentMember.dateOfBirth.slice(0, 4))
    : 0;

  const baseEstateTax = buildEstateTaxResult({
    year: input.year,
    deathOrder: 2,
    deceased: input.deceased,
    gross,
    deductions: finalDeductions,
    adjustedTaxableGifts: adjustedGifts,
    adjustedTaxableGiftsByYear: adjustedGiftsByYear,
    beaAtDeathYear,
    dsueReceived: input.dsueReceived,
    probateCostRate,
    probateEstate,
    residenceState: input.planSettings.residenceState ?? null,
    stateEstateTaxFallbackRate: input.planSettings.flatStateEstateRate ?? 0,
    inflationRate: taxInflation,
    estateTaxDebits: estateTaxDrain.debits,
    creditorPayoffDebits: creditorDrain.debits,
    creditorPayoffResidual: creditorDrain.residual,
    transfersForInheritance: ledger,
    accounts: input.accounts,
    familyMembers: input.familyMembers,
    externalBeneficiaries: input.externalBeneficiaries,
    decedentAgeAtDeath,
  });

  // Phase 9b — drain attribution. Per-recipient × drain-kind allocation of the
  // (now gross) ledger using the residuary-aware rule. Sums per kind reconcile
  // to baseEstateTax fields + creditorDrain.drainedTotal.
  const drainAttributions = attributeDrainsToLedger({
    deathOrder: 2,
    transfers: ledger,
    estateTax: baseEstateTax,
    creditorDrainTotal: creditorDrain.drainedTotal,
    will: input.will,
    deceased: input.deceased,
    // Read the SAME tier the chain's step-3c distribution used — single
    // source of truth, so distribution and drain attribution never desync.
    residuaryTier: chainResult.residuaryTier,
  });
  const irdTaxRate = input.planSettings.irdTaxRate ?? 0;
  const irdAttributions = computeIrdAttributions({
    deathOrder: 2,
    transfers: ledger,
    accounts: input.accounts,
    externalBeneficiaries: input.externalBeneficiaries,
    irdTaxRate,
  });
  if (
    hasUntaxedInheritedIrd({
      transfers: ledger,
      accounts: input.accounts,
      externalBeneficiaries: input.externalBeneficiaries,
      irdTaxRate,
    })
  ) {
    warnings.push("ird_tax_rate_unset");
  }
  const estateTax: EstateTaxResult = {
    ...baseEstateTax,
    drainAttributions: [...drainAttributions, ...irdAttributions],
  };

  assertFinalDeathInvariants(estateTax, mutatedEntities, input.deceased, ledger, workingLiabs, prepared.liabilities);

  return {
    accounts: accountsAfterBiz,
    accountBalances: chainResult.accountBalances,
    basisMap: basisMapAfterBiz,
    incomes: chainResult.incomes,
    liabilities: workingLiabs,
    transfers: ledger,
    warnings,
    estateTax,
    dsueGenerated: 0,
    lifeInsurancePayouts: li.lifeInsurancePayouts,
    entities: mutatedEntities,
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
  assertDrainAttributionsReconcile(estateTax, "final-death:");
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
  // New liability rows from bequests: exactly one ownership kind set (FM or entity, not both or neither)
  for (const row of workingLiabs) {
    if (!row.id.startsWith("death-liab-bequest")) continue;
    const fam = row.ownerFamilyMemberId != null;
    const ent = controllingEntity(row) != null;
    if (fam === ent) {
      throw new Error(`[4e] bequest-derived liability ${row.id} must have exactly one ownership kind (family_member or entity)`);
    }
  }
}

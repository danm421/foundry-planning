import { cache } from "react";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  accountAssetAllocations,
  accountFlowOverrides,
  accountHoldings,
  accountOwners,
  assetClasses,
  assetTransactions,
  beneficiaryDesignations,
  clientCmaOverrides,
  clientDeductions,
  clients,
  crmHouseholdContacts,
  entities,
  entityFlowOverrides,
  entityOwners,
  trustSplitInterestDetails,
  expenses,
  expenseScheduleOverrides,
  externalBeneficiaries,
  extraPayments,
  familyMembers,
  gifts,
  giftSeries,
  incomes,
  incomeScheduleOverrides,
  liabilities,
  liabilityOwners,
  modelPortfolioAllocations,
  modelPortfolios,
  planSettings,
  savingsRules,
  savingsScheduleOverrides,
  scenarios,
  taxYearParameters,
  reinvestments,
  reinvestmentAccounts,
  reinvestmentGroups,
  accountGroups,
  accountGroupMembers,
  rothConversions,
  rothConversionSources,
  transfers,
  transferSchedules,
  willBequestRecipients,
  willBequests,
  willResiduaryRecipients,
  wills,
  withdrawalStrategies,
  holdingAssetClassOverrides,
  medicareCoverage,
  securityAssetClassWeights,
  revocableTrusts,
} from "@/db/schema";
import type {
  AccountFlowOverride,
  BeneficiaryRef,
  ClientData,
  EntityFlowOverride,
  GiftEvent,
  Reinvestment,
  Will,
  WillBequest,
  WillResiduaryRecipient,
} from "@/engine/types";
import { fanOutGiftSeries } from "@/engine/series-fanout";
import { buildAnnualExclusionMap } from "@/lib/gifts/resolve-annual-exclusion";
import type { AccountOwner, EntityOwner } from "@/engine/ownership";
import { sortOwners } from "@/engine/ownership";
import { dbRowToTaxYearParameters } from "@/lib/tax/dbMapper";
import { resolveInflationRate } from "@/lib/inflation";
import { buildClientMilestones, resolveMilestone, type YearRef } from "@/lib/milestones";
import { loadPoliciesByAccountIds } from "@/lib/insurance-policies/load-policies";
import { withSynthesizedPremiums } from "@/lib/insurance-policies/premium-expense";
import { withSynthesizedPolicyIncome } from "@/lib/insurance-policies/policy-income";
import { withSynthesizedPremiumGifts } from "@/lib/insurance-policies/premium-gift";
import { loadNotesReceivable } from "@/lib/loaders/notes-receivable";
import { loadStockOptionPlans } from "./load-equity";
import { rowToMedicareCoverage } from "@/lib/medicare/dbMapper";
import { DEFAULT_MEDICARE_PREMIUM_INFLATION_RATE } from "@/lib/medicare/constants";
import { type HoldingInput } from "@/lib/investments/holdings-rollup";
import { computeHoldingsTotals } from "./holdings-totals";
import { createGrowthSourceResolver } from "./resolve-growth-source";
import { loadTickerPortfolioAllocations } from "@/lib/investments/load-ticker-portfolio-allocations";
import {
  resolveAccountFromRaw,
  resolveIncomeFromRaw,
  resolveExpenseFromRaw,
  resolveSavingsRuleFromRaw,
  type ResolutionContext,
} from "./resolve-entity";
import { type AllocationMap } from "./reinvestment-sold-fraction";
import { resolveReinvestments } from "./resolve-reinvestments";
import { expandReinvestmentTargets } from "./expand-reinvestment-targets";
import { isLiquid, type AccountCategory } from "@/lib/account-groups/liquid-filter";

export class ClientNotFoundError extends Error {
  constructor(public clientId: string) {
    super(`Client ${clientId} not found`);
    this.name = "ClientNotFoundError";
  }
}

export class ProjectionInputError extends Error {
  constructor(
    message: string,
    public override cause?: unknown,
  ) {
    super(message);
    this.name = "ProjectionInputError";
  }
}

export const loadClientDataWithContext = cache(
  async (
    clientId: string,
    firmId: string,
  ): Promise<{ clientData: ClientData; resolutionContext: ResolutionContext }> => {
    // Verify client access
    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));

    if (!client) {
      throw new ClientNotFoundError(clientId);
    }

    // CRM contacts — sole source of truth for identity fields (first/last
    // name, DOB). Schema guarantees crm_household_id is NOT NULL on the
    // clients row, and the contacts loader's contract is that a primary
    // contact with a date of birth exists.
    const crmContactRows = await db
      .select()
      .from(crmHouseholdContacts)
      .where(eq(crmHouseholdContacts.householdId, client.crmHouseholdId));
    const primaryContact = crmContactRows.find((c) => c.role === "primary") ?? null;
    const spouseContact = crmContactRows.find((c) => c.role === "spouse") ?? null;

    if (!primaryContact) {
      throw new ProjectionInputError(
        `Client ${clientId} CRM household ${client.crmHouseholdId} has no primary contact`,
      );
    }
    const clientDob = primaryContact.dateOfBirth;
    if (!clientDob) {
      throw new ProjectionInputError(
        `Client ${clientId} primary contact has no date of birth`,
      );
    }
    const clientFirstName = primaryContact.firstName;
    const clientLastName = primaryContact.lastName;
    const spouseFirstName = spouseContact?.firstName ?? undefined;
    const spouseDob = spouseContact?.dateOfBirth ?? undefined;

    // Get base case scenario
    const [scenario] = await db
      .select()
      .from(scenarios)
      .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)));

    if (!scenario) {
      throw new ProjectionInputError(`Client ${clientId} has no base case scenario`);
    }

    const id = clientId;

    // Fetch all projection data in parallel (including CMA data)
    const [
      accountRows,
      incomeRows,
      expenseRows,
      liabilityRows,
      savingsRuleRows,
      withdrawalRows,
      planSettingsRows,
      entityRows,
      portfolioRows,
      allocationRows,
      assetClassRows,
      extraPaymentRows,
      transferRows,
      transferScheduleRows,
      reinvestmentRows,
      reinvestmentAccountRows,
      reinvestmentGroupRows,
      accountGroupMemberRows,
      rothConversionRows,
      rothConversionSourceRows,
      assetTransactionRows,
      giftRows,
      familyMemberRows,
      externalBeneficiaryRows,
      giftSeriesRows,
      medicareCoverageRows,
    ] = await Promise.all([
      db.select().from(accounts).where(and(eq(accounts.clientId, id), eq(accounts.scenarioId, scenario.id))),
      db.select().from(incomes).where(and(eq(incomes.clientId, id), eq(incomes.scenarioId, scenario.id))),
      db.select().from(expenses).where(and(eq(expenses.clientId, id), eq(expenses.scenarioId, scenario.id))),
      db.select().from(liabilities).where(and(eq(liabilities.clientId, id), eq(liabilities.scenarioId, scenario.id))),
      db.select().from(savingsRules).where(and(eq(savingsRules.clientId, id), eq(savingsRules.scenarioId, scenario.id))),
      db.select().from(withdrawalStrategies).where(and(eq(withdrawalStrategies.clientId, id), eq(withdrawalStrategies.scenarioId, scenario.id))),
      db.select().from(planSettings).where(and(eq(planSettings.clientId, id), eq(planSettings.scenarioId, scenario.id))),
      db.select().from(entities).where(eq(entities.clientId, id)),
      db.select().from(modelPortfolios).where(eq(modelPortfolios.firmId, firmId)),
      db.select().from(modelPortfolioAllocations),
      db.select().from(assetClasses).where(eq(assetClasses.firmId, firmId)),
      db.select().from(extraPayments),
      db.select().from(transfers).where(and(eq(transfers.clientId, id), eq(transfers.scenarioId, scenario.id))),
      db.select().from(transferSchedules),
      db.select().from(reinvestments).where(and(eq(reinvestments.clientId, id), eq(reinvestments.scenarioId, scenario.id))),
      db.select().from(reinvestmentAccounts),
      db.select().from(reinvestmentGroups),
      db
        .select({
          accountGroupId: accountGroupMembers.accountGroupId,
          accountId: accountGroupMembers.accountId,
        })
        .from(accountGroupMembers)
        .innerJoin(accountGroups, eq(accountGroups.id, accountGroupMembers.accountGroupId))
        .where(eq(accountGroups.clientId, id)),
      db.select().from(rothConversions).where(and(eq(rothConversions.clientId, id), eq(rothConversions.scenarioId, scenario.id))),
      db.select().from(rothConversionSources),
      db.select().from(assetTransactions).where(and(eq(assetTransactions.clientId, id), eq(assetTransactions.scenarioId, scenario.id))),
      db
        .select()
        .from(gifts)
        .where(eq(gifts.clientId, id))
        .orderBy(asc(gifts.year), asc(gifts.createdAt)),
      db.select().from(familyMembers).where(eq(familyMembers.clientId, id)).orderBy(asc(familyMembers.dateOfBirth)),
      db.select().from(externalBeneficiaries).where(eq(externalBeneficiaries.clientId, id)),
      db
        .select()
        .from(giftSeries)
        .where(and(eq(giftSeries.clientId, id), eq(giftSeries.scenarioId, scenario.id))),
      // medicare_coverage is client-scoped (shared across scenarios), not scenario-scoped.
      db.select().from(medicareCoverage).where(eq(medicareCoverage.clientId, id)),
    ]);

    // revocable_trusts is client-scoped (not scenario-scoped) — one fetch, reused below
    const revocableTrustRows = await db
      .select({ id: revocableTrusts.id, name: revocableTrusts.name })
      .from(revocableTrusts)
      .where(eq(revocableTrusts.clientId, id));
    const revocableTrustNameById = new Map(revocableTrustRows.map((t) => [t.id, t.name]));

    // Load schedule overrides for all incomes, expenses, and savings rules
    const incomeIds = incomeRows.map((i) => i.id);
    const expenseIds = expenseRows.map((e) => e.id);
    const savingsRuleIds = savingsRuleRows.map((s) => s.id);

    const [incomeOverrideRows, expenseOverrideRows, savingsOverrideRows] = await Promise.all([
      incomeIds.length > 0
        ? db.select().from(incomeScheduleOverrides).where(inArray(incomeScheduleOverrides.incomeId, incomeIds))
        : Promise.resolve([]),
      expenseIds.length > 0
        ? db.select().from(expenseScheduleOverrides).where(inArray(expenseScheduleOverrides.expenseId, expenseIds))
        : Promise.resolve([]),
      savingsRuleIds.length > 0
        ? db.select().from(savingsScheduleOverrides).where(inArray(savingsScheduleOverrides.savingsRuleId, savingsRuleIds))
        : Promise.resolve([]),
    ]);

    // Build lookup maps: entityId → Record<year, amount>. Plain objects (not
    // Maps) so the tree round-trips cleanly through JSON — Maps serialize to
    // `{}`, which would break any client that fetches `effectiveTree` via the
    // projection-data API or reads it back from a frozen scenario snapshot.
    const incomeOverrideMap = new Map<string, Record<number, number>>();
    for (const row of incomeOverrideRows) {
      const bucket = incomeOverrideMap.get(row.incomeId) ?? {};
      bucket[row.year] = parseFloat(row.amount);
      incomeOverrideMap.set(row.incomeId, bucket);
    }

    const expenseOverrideMap = new Map<string, Record<number, number>>();
    for (const row of expenseOverrideRows) {
      const bucket = expenseOverrideMap.get(row.expenseId) ?? {};
      bucket[row.year] = parseFloat(row.amount);
      expenseOverrideMap.set(row.expenseId, bucket);
    }

    const savingsOverrideMap = new Map<string, Record<number, number>>();
    for (const row of savingsOverrideRows) {
      const bucket = savingsOverrideMap.get(row.savingsRuleId) ?? {};
      bucket[row.year] = parseFloat(row.amount);
      savingsOverrideMap.set(row.savingsRuleId, bucket);
    }

    const [settings] = planSettingsRows;

    if (!settings) {
      throw new ProjectionInputError(`Client ${clientId} has no plan_settings row`);
    }

    // Position-aware milestone resolution. When a row has a startYearRef /
    // endYearRef set, re-derive its numeric year so the engine sees the
    // correct value even if the stored startYear/endYear is stale (e.g.,
    // retirement age changed, or row was saved before the position-aware
    // resolution rule landed). Transition refs (`*_retirement`, `*_end`,
    // `*_ss_*`) returned for `position: "end"` are `year - 1`, so a stream
    // ending at retirement stops the year *before* the retirement year and
    // doesn't overlap with streams starting at retirement.
    const refMilestones = buildClientMilestones(
      {
        dateOfBirth: clientDob,
        retirementAge: client.retirementAge,
        planEndAge: client.planEndAge,
        spouseDob: spouseDob ?? null,
        spouseRetirementAge: client.spouseRetirementAge ?? null,
      },
      settings.planStartYear,
      settings.planEndYear,
    );
    const resolvedStart = (
      ref: string | null,
      stored: number,
    ): number => {
      if (!ref) return stored;
      const r = resolveMilestone(ref as YearRef, refMilestones, "start");
      return r ?? stored;
    };
    const resolvedEnd = (
      ref: string | null,
      stored: number,
    ): number => {
      if (!ref) return stored;
      const r = resolveMilestone(ref as YearRef, refMilestones, "end");
      return r ?? stored;
    };

    // Load tax year parameters for the projection engine
    const taxYearRows = await db
      .select()
      .from(taxYearParameters)
      .orderBy(asc(taxYearParameters.year));
    const parsedTaxRows = taxYearRows.map(dbRowToTaxYearParameters);

    // Load deductions for the base case scenario
    const deductionRows = await db
      .select()
      .from(clientDeductions)
      .where(and(eq(clientDeductions.clientId, id), eq(clientDeductions.scenarioId, scenario.id)));

    const parsedDeductions = deductionRows.map((d) => ({
      type: d.type,
      annualAmount: parseFloat(d.annualAmount),
      growthRate: parseFloat(d.growthRate),
      startYear: d.startYear,
      endYear: d.endYear,
    }));

    // Load account-level asset allocations (for asset_mix growth source)
    let accountAllocRows: (typeof accountAssetAllocations.$inferSelect)[] = [];
    if (accountRows.length > 0) {
      accountAllocRows = await db
        .select()
        .from(accountAssetAllocations)
        .where(
          inArray(
            accountAssetAllocations.accountId,
            accountRows.map((a) => a.id),
          ),
        );
    }

    // ── Holdings (growthSource = "holdings") ─────────────────────────────────
    let holdingRows: (typeof accountHoldings.$inferSelect)[] = [];
    if (accountRows.length > 0) {
      holdingRows = await db
        .select()
        .from(accountHoldings)
        .where(inArray(accountHoldings.accountId, accountRows.map((a) => a.id)));
    }
    const holdingIds = holdingRows.map((h) => h.id);
    const securityIds = Array.from(
      new Set(holdingRows.map((h) => h.securityId).filter((s): s is string => s != null)),
    );
    const [holdingOverrideRows, securityWeightRows] = await Promise.all([
      holdingIds.length
        ? db.select().from(holdingAssetClassOverrides)
            .where(inArray(holdingAssetClassOverrides.holdingId, holdingIds))
        : Promise.resolve([]),
      securityIds.length
        ? db.select().from(securityAssetClassWeights)
            .where(inArray(securityAssetClassWeights.securityId, securityIds))
        : Promise.resolve([]),
    ]);

    // Load ownership junction rows for accounts and liabilities
    const accountIds = accountRows.map((a) => a.id);
    const liabilityIds = liabilityRows.map((l) => l.id);
    const [accountOwnerRows, liabilityOwnerRows] = await Promise.all([
      accountIds.length > 0
        ? db.select().from(accountOwners).where(inArray(accountOwners.accountId, accountIds))
        : Promise.resolve([]),
      liabilityIds.length > 0
        ? db.select().from(liabilityOwners).where(inArray(liabilityOwners.liabilityId, liabilityIds))
        : Promise.resolve([]),
    ]);

    // Build owners lookup maps
    const ownersByAccountId = new Map<string, AccountOwner[]>();
    for (const r of accountOwnerRows) {
      // The DB CHECK guarantees exactly one of family_member_id / entity_id /
      // external_beneficiary_id is set. Check external_beneficiary first so the
      // new kind takes precedence when set.
      let owner: AccountOwner;
      if (r.externalBeneficiaryId != null) {
        owner = {
          kind: "external_beneficiary",
          externalBeneficiaryId: r.externalBeneficiaryId,
          percent: parseFloat(r.percent),
        };
      } else if (r.familyMemberId) {
        owner = { kind: "family_member", familyMemberId: r.familyMemberId, percent: parseFloat(r.percent) };
      } else {
        owner = { kind: "entity", entityId: r.entityId!, percent: parseFloat(r.percent) };
      }
      const arr = ownersByAccountId.get(r.accountId) ?? [];
      arr.push(owner);
      ownersByAccountId.set(r.accountId, arr);
    }

    const ownersByLiabilityId = new Map<string, AccountOwner[]>();
    for (const r of liabilityOwnerRows) {
      const owner: AccountOwner = r.familyMemberId
        ? { kind: "family_member", familyMemberId: r.familyMemberId, percent: parseFloat(r.percent) }
        : { kind: "entity", entityId: r.entityId!, percent: parseFloat(r.percent) };
      const arr = ownersByLiabilityId.get(r.liabilityId) ?? [];
      arr.push(owner);
      ownersByLiabilityId.set(r.liabilityId, arr);
    }

    // Owner arrays are built from a junction query with no ORDER BY, so their
    // order is undefined and can differ between two loads. Sort each into a
    // stable order so scenario-change diffs don't report a phantom `owners`
    // change when the solver page-load and the save-time reload disagree.
    for (const [id, arr] of ownersByAccountId) ownersByAccountId.set(id, sortOwners(arr));
    for (const [id, arr] of ownersByLiabilityId) ownersByLiabilityId.set(id, sortOwners(arr));

    // ── CMA resolution ─────────────────────────────────────────────────────────

    const inflationClass = assetClassRows.find((ac) => ac.slug === "inflation");

    // Resolve the effective inflation rate for this plan
    let clientInflationOverride: { geometricReturn: string } | null = null;
    if (settings.useCustomCma && inflationClass) {
      const [override] = await db
        .select({ geometricReturn: clientCmaOverrides.geometricReturn })
        .from(clientCmaOverrides)
        .where(
          and(
            eq(clientCmaOverrides.clientId, id),
            eq(clientCmaOverrides.sourceAssetClassId, inflationClass.id),
          ),
        );
      if (override) clientInflationOverride = override;
    }

    // Resolve the household's effective inflation rate. This is THE inflation
    // rate the engine sees: it feeds both the per-row "grow at inflation"
    // consumers (accounts, income, expenses, savings rules) AND the engine's
    // `planSettings.inflationRate` fallback for tax-bracket indexing,
    // SS-wage-growth, gift annual-exclusion, and estate-exemption inflation.
    // When source = "asset_class" this is the asset-class geometric return; when
    // "custom" it is the raw inflation_rate column.
    const resolvedInflationRate = resolveInflationRate(
      {
        inflationRateSource: settings.inflationRateSource,
        inflationRate: settings.inflationRate,
      },
      inflationClass ? { geometricReturn: inflationClass.geometricReturn } : null,
      clientInflationOverride,
    );

    // Load client CMA overrides for the resolver (all overrides, not just inflation)
    const cmaOverrideRows = settings.useCustomCma
      ? await db
          .select()
          .from(clientCmaOverrides)
          .where(eq(clientCmaOverrides.clientId, id))
      : [];

    // Slug → firm assetClassId map (assetClassRows carry the canonical slug).
    const slugToAssetClassId = new Map<string, string>();
    for (const ac of assetClassRows) {
      if (ac.slug) slugToAssetClassId.set(ac.slug, ac.id);
    }
    const tickerPortfolioAllocations = await loadTickerPortfolioAllocations(firmId, slugToAssetClassId);

    const overridesByHolding = new Map<string, { assetClassId: string; weight: number }[]>();
    for (const o of holdingOverrideRows) {
      const list = overridesByHolding.get(o.holdingId) ?? [];
      list.push({ assetClassId: o.assetClassId, weight: parseFloat(o.weight) });
      overridesByHolding.set(o.holdingId, list);
    }
    const weightsBySecurity = new Map<string, { slug: string; weight: number }[]>();
    for (const w of securityWeightRows) {
      const list = weightsBySecurity.get(w.securityId) ?? [];
      list.push({ slug: w.assetClassSlug, weight: parseFloat(w.weight) });
      weightsBySecurity.set(w.securityId, list);
    }
    const holdingsByAccountId = new Map<string, HoldingInput[]>();
    for (const h of holdingRows) {
      const list = holdingsByAccountId.get(h.accountId) ?? [];
      list.push({
        id: h.id,
        securityId: h.securityId,
        shares: parseFloat(h.shares),
        price: parseFloat(h.price),
        costBasis: parseFloat(h.costBasis),
        marketValue: h.marketValue != null ? parseFloat(h.marketValue) : null,
        securityWeights: h.securityId ? weightsBySecurity.get(h.securityId) ?? [] : [],
        overrides: overridesByHolding.get(h.id) ?? [],
      });
      holdingsByAccountId.set(h.accountId, list);
    }

    // Accounts driven by their holdings (deriveFromHoldings, ≥1 holding) take
    // their value/basis from the rollup. The blend itself is no longer rolled
    // up here — syncAccountFromHoldings persists it into account_asset_allocations
    // on write, so it flows through the normal asset_mix path.
    const holdingsTotalsByAccountId = computeHoldingsTotals({
      accounts: accountRows,
      holdingsByAccountId,
      slugToAssetClassId,
    });

    // Growth-source resolver — owns allocsByPortfolio, allocsByAccount, acMap,
    // inflationFallback. Resolver API replaces the inline resolve* helpers from route.ts.
    const resolver = createGrowthSourceResolver({
      planSettings: {
        ...settings,
        inflationAssetClassId: inflationClass?.id ?? null,
      },
      assetClasses: assetClassRows,
      modelPortfolios: portfolioRows,
      // DB schema uses modelPortfolioId; resolver type expects portfolioId
      modelPortfolioAllocations: allocationRows.map((a) => ({
        portfolioId: a.modelPortfolioId,
        assetClassId: a.assetClassId,
        weight: a.weight,
      })),
      // Only pass allocations belonging to accounts fetched for this client
      accountAssetAllocations: accountAllocRows.filter((a) =>
        accountRows.some((acc) => acc.id === a.accountId),
      ),
      // DB schema uses sourceAssetClassId; resolver type expects assetClassId
      clientCmaOverrides: cmaOverrideRows
        .filter((o) => o.sourceAssetClassId != null)
        .map((o) => ({
          assetClassId: o.sourceAssetClassId!,
          geometricReturn: o.geometricReturn,
        })),
      tickerPortfolioAllocations,
    });

    // ── Beneficiary designations ────────────────────────────────────────────
    const designationRows = await db
      .select()
      .from(beneficiaryDesignations)
      .where(eq(beneficiaryDesignations.clientId, id))
      .orderBy(asc(beneficiaryDesignations.tier), asc(beneficiaryDesignations.sortOrder));

    const accountBens = new Map<string, BeneficiaryRef[]>();
    const trustBens = new Map<string, BeneficiaryRef[]>();
    for (const d of designationRows) {
      // income/remainder tiers are handled separately via incomeBeneficiaryRows
      if (d.tier !== "primary" && d.tier !== "contingent") continue;
      const ref: BeneficiaryRef = {
        id: d.id,
        tier: d.tier,
        percentage: parseFloat(d.percentage),
        familyMemberId: d.familyMemberId ?? undefined,
        externalBeneficiaryId: d.externalBeneficiaryId ?? undefined,
        entityIdRef: d.entityIdRef ?? undefined,
        householdRole: (d.householdRole as "client" | "spouse" | null) ?? undefined,
        sortOrder: d.sortOrder,
      };
      if (d.targetKind === "account" && d.accountId) {
        const arr = accountBens.get(d.accountId) ?? [];
        arr.push(ref);
        accountBens.set(d.accountId, arr);
      } else if (d.targetKind === "trust" && d.entityId) {
        const arr = trustBens.get(d.entityId) ?? [];
        arr.push(ref);
        trustBens.set(d.entityId, arr);
      }
    }

    // ── Wills loader ────────────────────────────────────────────────────────
    const willRows = await db
      .select()
      .from(wills)
      .where(eq(wills.clientId, id))
      .orderBy(asc(wills.grantor));
    const willIds = willRows.map((w) => w.id);
    const willBequestRows = willIds.length
      ? await db
          .select()
          .from(willBequests)
          .where(inArray(willBequests.willId, willIds))
          .orderBy(asc(willBequests.willId), asc(willBequests.sortOrder))
      : [];
    const bequestIds = willBequestRows.map((b) => b.id);
    const willRecipientRows = bequestIds.length
      ? await db
          .select()
          .from(willBequestRecipients)
          .where(inArray(willBequestRecipients.bequestId, bequestIds))
          .orderBy(
            asc(willBequestRecipients.bequestId),
            asc(willBequestRecipients.sortOrder),
          )
      : [];

    const willResiduaryRows = willIds.length
      ? await db
          .select()
          .from(willResiduaryRecipients)
          .where(inArray(willResiduaryRecipients.willId, willIds))
          .orderBy(
            asc(willResiduaryRecipients.willId),
            asc(willResiduaryRecipients.sortOrder),
          )
      : [];

    const recipientsByBequest = new Map<string, typeof willRecipientRows>();
    for (const r of willRecipientRows) {
      const list = recipientsByBequest.get(r.bequestId) ?? [];
      list.push(r);
      recipientsByBequest.set(r.bequestId, list);
    }
    const bequestsByWill = new Map<string, WillBequest[]>();
    for (const b of willBequestRows) {
      const list = bequestsByWill.get(b.willId) ?? [];
      list.push({
        id: b.id,
        name: b.name,
        kind: b.kind,
        assetMode: b.assetMode ?? null,
        accountId: b.accountId,
        entityId: b.entityId,
        liabilityId: b.liabilityId ?? null,
        percentage: parseFloat(b.percentage),
        condition: b.condition,
        sortOrder: b.sortOrder,
        recipients: (recipientsByBequest.get(b.id) ?? []).map((r) => ({
          recipientKind: r.recipientKind,
          recipientId: r.recipientId,
          percentage: parseFloat(r.percentage),
          sortOrder: r.sortOrder,
        })),
      });
      bequestsByWill.set(b.willId, list);
    }

    const residuaryByWill = new Map<string, WillResiduaryRecipient[]>();
    for (const r of willResiduaryRows) {
      const list = residuaryByWill.get(r.willId) ?? [];
      list.push({
        recipientKind: r.recipientKind,
        recipientId: r.recipientId,
        tier: r.tier,
        percentage: parseFloat(r.percentage),
        sortOrder: r.sortOrder,
      });
      residuaryByWill.set(r.willId, list);
    }

    const engineWills: Will[] = willRows.map((w) => {
      const residuary = residuaryByWill.get(w.id);
      return {
        id: w.id,
        grantor: w.grantor,
        bequests: bequestsByWill.get(w.id) ?? [],
        ...(residuary && residuary.length > 0
          ? { residuaryRecipients: residuary }
          : {}),
      };
    });

    // ── Life-insurance policies ────────────────────────────────────────────
    const lifeInsuranceAccountIds = accountRows
      .filter((a) => a.category === "life_insurance")
      .map((a) => a.id);
    const policiesByAccount = await loadPoliciesByAccountIds(lifeInsuranceAccountIds);

    // ── Reinvestment base-allocation map ────────────────────────────────────
    // An account's BASE allocation (before any reinvestment), derived from the
    // account's effective growth source. A `default` source is resolved
    // through the category-default model portfolio — an intentional,
    // allocation-correct extension that `resolveAccountFromRaw` does not make.
    // Resolves to undefined for flat-rate / inflation / custom sources with no
    // asset-class breakdown. Built here (raw account rows in scope) and threaded
    // onto `ResolutionContext` so the scenario overlay can reuse it.
    const accountBaseAllocByAccountId = new Map<string, AllocationMap | undefined>();
    // Account ids whose resolved growthRate / propertyTaxGrowthRate are driven
    // by the inflation rate. The engine `Account` drops `growthSource`, so the
    // scenario overlay needs these to re-resolve them under a scenario-edited
    // inflation rate (see `reResolveInflationGrowth`). `resolveAccountFromRaw`
    // pins growthRate to the inflation rate iff `growthSource === "inflation"`.
    const accountGrowthFromInflation = new Set<string>();
    const accountPropertyTaxFromInflation = new Set<string>();
    for (const account of accountRows) {
      const gs = account.growthSource ?? "default";
      if (gs === "inflation") accountGrowthFromInflation.add(account.id);
      if (account.propertyTaxGrowthSource === "inflation") {
        accountPropertyTaxFromInflation.add(account.id);
      }
      const categorySource = resolver.getCategoryGrowthSource(account.category);
      const effectiveSource = gs === "default" ? categorySource : gs;
      let baseAlloc: AllocationMap | undefined;
      if (effectiveSource === "model_portfolio") {
        const portfolioId =
          gs === "default"
            ? resolver.categoryDefaultPortfolioId(account.category)
            : account.modelPortfolioId;
        baseAlloc = portfolioId
          ? resolver.portfolioAllocMap(portfolioId)
          : undefined;
      } else if (effectiveSource === "asset_mix") {
        baseAlloc = resolver.accountAllocMap(account.id);
      } else if (effectiveSource === "ticker_portfolio") {
        baseAlloc = account.tickerPortfolioId
          ? resolver.tickerPortfolioAllocMap(account.tickerPortfolioId)
          : undefined;
      }
      accountBaseAllocByAccountId.set(account.id, baseAlloc);
    }

    // ── Build ClientData ────────────────────────────────────────────────────

    // Convert Drizzle decimal strings to numbers for the engine

    const resolutionCtx: ResolutionContext = {
      resolver,
      resolvedInflationRate,
      beneficiariesByAccountId: accountBens,
      policiesByAccount,
      ownersByAccountId,
      accountBaseAllocByAccountId,
      holdingsTotalsByAccountId,
      resolvedInflationInputs: {
        inflationRateSource: settings.inflationRateSource,
        inflationClass: inflationClass
          ? { geometricReturn: inflationClass.geometricReturn }
          : null,
        clientOverride: clientInflationOverride,
      },
      accountGrowthFromInflation,
      accountPropertyTaxFromInflation,
    };

    const mappedAccounts = accountRows.map((a) => {
      const acct = resolveAccountFromRaw(
        {
          id: a.id,
          name: a.name,
          category: a.category,
          subType: a.subType,
          value: a.value,
          basis: a.basis,
          rothValue: a.rothValue,
          hsaCoverage: a.hsaCoverage,
          growthSource: a.growthSource,
          growthRate: a.growthRate,
          turnoverPct: a.turnoverPct,
          annualPropertyTax: a.annualPropertyTax,
          propertyTaxGrowthRate: a.propertyTaxGrowthRate,
          propertyTaxGrowthSource: a.propertyTaxGrowthSource,
          rmdEnabled: a.rmdEnabled,
          isDefaultChecking: a.isDefaultChecking,
          modelPortfolioId: a.modelPortfolioId,
          tickerPortfolioId: a.tickerPortfolioId,
          overridePctOi: a.overridePctOi,
          overridePctLtCg: a.overridePctLtCg,
          overridePctQdiv: a.overridePctQdiv,
          overridePctTaxExempt: a.overridePctTaxExempt,
          priorYearEndValue: a.priorYearEndValue,
          insuredPerson: a.insuredPerson,
          titlingType: a.titlingType,
          businessType: a.businessType,
          distributionPolicyPercent: a.distributionPolicyPercent,
          flowMode: a.flowMode,
          businessTaxTreatment: a.businessTaxTreatment,
          parentAccountId: a.parentAccountId,
        },
        resolutionCtx,
      );
      acct.revocableTrustName = a.revocableTrustId
        ? (revocableTrustNameById.get(a.revocableTrustId) ?? null)
        : null;
      return acct;
    });

    const mappedIncomes = incomeRows.map((i) =>
      resolveIncomeFromRaw(
        {
          id: i.id,
          type: i.type,
          name: i.name,
          annualAmount: i.annualAmount,
          startYear: resolvedStart(i.startYearRef, i.startYear),
          endYear: resolvedEnd(i.endYearRef, i.endYear),
          growthSource: i.growthSource,
          growthRate: i.growthRate,
          owner: i.owner,
          claimingAge: i.claimingAge,
          ownerEntityId: i.ownerEntityId,
          ownerAccountId: i.ownerAccountId,
          cashAccountId: i.cashAccountId,
          inflationStartYear: i.inflationStartYear,
          taxType: i.taxType,
          ssBenefitMode: i.ssBenefitMode,
          piaMonthly: i.piaMonthly,
          claimingAgeMonths: i.claimingAgeMonths,
          claimingAgeMode: i.claimingAgeMode,
          startYearRef: i.startYearRef,
          endYearRef: i.endYearRef,
          scheduleOverrides: incomeOverrideMap.get(i.id),
        },
        resolutionCtx,
      ),
    );

    const mappedExpenses = expenseRows.map((e) =>
      resolveExpenseFromRaw(
        {
          id: e.id,
          type: e.type,
          name: e.name,
          annualAmount: e.annualAmount,
          startYear: resolvedStart(e.startYearRef, e.startYear),
          endYear: resolvedEnd(e.endYearRef, e.endYear),
          growthSource: e.growthSource,
          growthRate: e.growthRate,
          ownerEntityId: e.ownerEntityId,
          ownerAccountId: e.ownerAccountId,
          cashAccountId: e.cashAccountId,
          inflationStartYear: e.inflationStartYear,
          deductionType: e.deductionType,
          startYearRef: e.startYearRef,
          endYearRef: e.endYearRef,
          scheduleOverrides: expenseOverrideMap.get(e.id),
          isDefault: e.isDefault,
        },
        resolutionCtx,
      ),
    );

    // Life-insurance premium expenses are synthesized via `withSynthesizedPremiums`
    // when the assembled tree is returned (below), so the same idempotent
    // derivation runs on both the base tree here and the effective tree in
    // `loadEffectiveTree` after the scenario overlay is applied.

    const mappedLiabilities = liabilityRows.map((l) => ({
      id: l.id,
      name: l.name,
      balance: parseFloat(l.balance),
      interestRate: parseFloat(l.interestRate),
      // Nullable since Phase 2 (revolving debt). Held-flat rows ignore these,
      // but the engine type is non-null — coerce null → 0.
      monthlyPayment: l.monthlyPayment != null ? parseFloat(l.monthlyPayment) : 0,
      startYear: l.startYear,
      startMonth: l.startMonth,
      termMonths: l.termMonths ?? 0,
      liabilityType: l.liabilityType ?? null,
      balanceAsOfMonth: l.balanceAsOfMonth ?? undefined,
      balanceAsOfYear: l.balanceAsOfYear ?? undefined,
      linkedPropertyId: l.linkedPropertyId ?? undefined,
      isInterestDeductible: l.isInterestDeductible,
      extraPayments: extraPaymentRows
        .filter((ep) => ep.liabilityId === l.id)
        .map((ep) => ({
          id: ep.id,
          liabilityId: ep.liabilityId,
          year: ep.year,
          type: ep.type,
          amount: parseFloat(ep.amount),
        })),
      owners: ownersByLiabilityId.get(l.id) ?? [],
      parentAccountId: l.parentAccountId ?? null,
    }));

    const mappedSavingsRules = savingsRuleRows.map((s) =>
      resolveSavingsRuleFromRaw(
        {
          id: s.id,
          accountId: s.accountId,
          annualAmount: s.annualAmount,
          annualPercent: s.annualPercent,
          rothPercent: s.rothPercent,
          isDeductible: s.isDeductible,
          applyContributionLimit: s.applyContributionLimit,
          contributeMax: s.contributeMax,
          startYear: resolvedStart(s.startYearRef, s.startYear),
          endYear: resolvedEnd(s.endYearRef, s.endYear),
          growthSource: s.growthSource,
          growthRate: s.growthRate,
          employerMatchPct: s.employerMatchPct,
          employerMatchCap: s.employerMatchCap,
          employerMatchAmount: s.employerMatchAmount,
          startYearRef: s.startYearRef,
          endYearRef: s.endYearRef,
          scheduleOverrides: savingsOverrideMap.get(s.id),
        },
        resolutionCtx,
      ),
    );

    const mappedWithdrawalStrategy = withdrawalRows.map((w) => ({
      // Carry the real DB uuid so scenario edit/remove overlays can match base
      // rows by id (applyEdit/applyRemove findIndex on e.id) and the writer's
      // lookupBaseEntity can build a real field diff instead of a phantom one.
      id: w.id,
      accountId: w.accountId,
      priorityOrder: w.priorityOrder,
      startYear: resolvedStart(w.startYearRef, w.startYear),
      endYear: resolvedEnd(w.endYearRef, w.endYear),
    }));

    const mappedPlanSettings = {
      flatFederalRate: parseFloat(settings.flatFederalRate),
      flatStateRate: parseFloat(settings.flatStateRate),
      estateAdminExpenses: settings.estateAdminExpenses != null ? parseFloat(settings.estateAdminExpenses) : 0,
      flatStateEstateRate: settings.flatStateEstateRate != null ? parseFloat(settings.flatStateEstateRate) : 0,
      residenceState: (settings.residenceState ?? null) as import("@/lib/usps-states").USPSStateCode | null,
      irdTaxRate: settings.irdTaxRate != null ? parseFloat(settings.irdTaxRate) : 0,
      probateCostRate: settings.probateCostRate != null ? parseFloat(settings.probateCostRate) : 0,
      // Engine reads `inflationRate` as the plan's effective general inflation —
      // the fallback for tax-bracket indexing, SS wage-base growth, gift
      // annual-exclusion, and estate-exemption inflation. Feed the RESOLVED rate
      // (asset-class geometric return when source = "asset_class") so those
      // defaults track the advisor's chosen default, not the raw inflation_rate
      // column. When source = "custom" this equals the column value.
      inflationRate: resolvedInflationRate,
      planStartYear: settings.planStartYear,
      planEndYear: settings.planEndYear,
      taxEngineMode: settings.taxEngineMode,
      taxInflationRate: settings.taxInflationRate != null ? parseFloat(settings.taxInflationRate) : null,
      lifetimeExemptionCap: settings.lifetimeExemptionCap != null ? parseFloat(settings.lifetimeExemptionCap) : null,
      ssWageGrowthRate: settings.ssWageGrowthRate != null ? parseFloat(settings.ssWageGrowthRate) : null,
      outOfHouseholdRate: settings.outOfHouseholdDniRate != null ? parseFloat(settings.outOfHouseholdDniRate) : undefined,
      priorTaxableGifts: {
        client: settings.priorTaxableGiftsClient != null ? parseFloat(settings.priorTaxableGiftsClient) : 0,
        spouse: settings.priorTaxableGiftsSpouse != null ? parseFloat(settings.priorTaxableGiftsSpouse) : 0,
      },
      surplusSpendPct: settings.surplusSpendPct != null ? parseFloat(settings.surplusSpendPct) : 0,
      surplusSaveAccountId: settings.surplusSaveAccountId ?? null,
    };

    // ── Income-tier beneficiary designations grouped by entity ──────────────
    const incomeBeneficiaryRows = entityRows.length > 0
      ? await db
          .select({
            entityId: beneficiaryDesignations.entityId,
            familyMemberId: beneficiaryDesignations.familyMemberId,
            externalBeneficiaryId: beneficiaryDesignations.externalBeneficiaryId,
            entityIdRef: beneficiaryDesignations.entityIdRef,
            householdRole: beneficiaryDesignations.householdRole,
            percentage: beneficiaryDesignations.percentage,
          })
          .from(beneficiaryDesignations)
          .where(
            and(
              eq(beneficiaryDesignations.tier, "income"),
              inArray(beneficiaryDesignations.entityId, entityRows.map((e) => e.id)),
            ),
          )
      : [];

    type IncomeBeneficiary = NonNullable<import("@/engine/types").EntitySummary["incomeBeneficiaries"]>[number];
    const incomeByEntity = new Map<string, IncomeBeneficiary[]>();
    for (const row of incomeBeneficiaryRows) {
      if (!row.entityId) continue;
      const list = incomeByEntity.get(row.entityId) ?? [];
      list.push({
        familyMemberId: row.familyMemberId ?? undefined,
        externalBeneficiaryId: row.externalBeneficiaryId ?? undefined,
        entityId: row.entityIdRef ?? undefined,
        householdRole: (row.householdRole as "client" | "spouse" | null) ?? undefined,
        percentage: Number(row.percentage),
      });
      incomeByEntity.set(row.entityId, list);
    }

    // ── Remainder-tier beneficiary designations grouped by entity ───────────
    const remainderBeneficiaryRows = entityRows.length > 0
      ? await db
          .select({
            entityId: beneficiaryDesignations.entityId,
            familyMemberId: beneficiaryDesignations.familyMemberId,
            externalBeneficiaryId: beneficiaryDesignations.externalBeneficiaryId,
            entityIdRef: beneficiaryDesignations.entityIdRef,
            householdRole: beneficiaryDesignations.householdRole,
            percentage: beneficiaryDesignations.percentage,
            distributionForm: beneficiaryDesignations.distributionForm,
          })
          .from(beneficiaryDesignations)
          .where(
            and(
              eq(beneficiaryDesignations.tier, "remainder"),
              inArray(beneficiaryDesignations.entityId, entityRows.map((e) => e.id)),
            ),
          )
      : [];

    type RemainderBeneficiary = NonNullable<
      import("@/engine/types").EntitySummary["remainderBeneficiaries"]
    >[number];
    const remainderByEntity = new Map<string, RemainderBeneficiary[]>();
    for (const row of remainderBeneficiaryRows) {
      if (!row.entityId) continue;
      const list = remainderByEntity.get(row.entityId) ?? [];
      list.push({
        familyMemberId: row.familyMemberId ?? undefined,
        externalBeneficiaryId: row.externalBeneficiaryId ?? undefined,
        entityIdRef: row.entityIdRef ?? undefined,
        householdRole: (row.householdRole as "client" | "spouse" | null) ?? undefined,
        percentage: Number(row.percentage),
        distributionForm: row.distributionForm === "in_trust" ? "in_trust" : "outright",
      });
      remainderByEntity.set(row.entityId, list);
    }

    // ── exemptionConsumed derived from gifts to each entity ──────────────────
    const exemptionByEntity = new Map<string, number>();
    for (const g of giftRows) {
      if (!g.recipientEntityId) continue;
      exemptionByEntity.set(
        g.recipientEntityId,
        (exemptionByEntity.get(g.recipientEntityId) ?? 0) + Number(g.amount),
      );
    }

    // ── Per-family-member ownership of business entities ─────────────────────
    const entityOwnerRows = entityRows.length > 0
      ? await db
          .select()
          .from(entityOwners)
          .where(inArray(entityOwners.entityId, entityRows.map((e) => e.id)))
      : [];
    // Polymorphic ownership of business entities — emit either a family_member
    // or entity owner depending on which column is set. CHECK constraint on
    // entity_owners guarantees exactly one is non-null.
    const ownersByEntity = new Map<string, EntityOwner[]>();
    for (const row of entityOwnerRows) {
      const list = ownersByEntity.get(row.entityId) ?? [];
      const owner: EntityOwner = row.familyMemberId
        ? {
            kind: "family_member",
            familyMemberId: row.familyMemberId,
            percent: parseFloat(row.percent),
          }
        : {
            kind: "entity",
            entityId: row.ownerEntityId!,
            percent: parseFloat(row.percent),
          };
      list.push(owner);
      ownersByEntity.set(row.entityId, list);
    }

    // ── Split-interest details (CLUT/CLAT) keyed by entity ──────────────────
    type TrustSplitInterestSnapshot =
      NonNullable<import("@/engine/types").EntitySummary["splitInterest"]>;
    const splitInterestRows = entityRows.length > 0
      ? await db
          .select()
          .from(trustSplitInterestDetails)
          .where(eq(trustSplitInterestDetails.clientId, id))
      : [];
    const splitInterestByEntityId = new Map<string, TrustSplitInterestSnapshot>(
      splitInterestRows.map((r) => [
        r.entityId,
        {
          inceptionYear: r.inceptionYear,
          inceptionValue: Number(r.inceptionValue),
          payoutType: r.payoutType,
          payoutPercent: r.payoutPercent != null ? Number(r.payoutPercent) : null,
          payoutAmount: r.payoutAmount != null ? Number(r.payoutAmount) : null,
          irc7520Rate: Number(r.irc7520Rate),
          termType: r.termType,
          termYears: r.termYears,
          measuringLife1Id: r.measuringLife1Id,
          measuringLife2Id: r.measuringLife2Id,
          charityId: r.charityId,
          originalIncomeInterest: Number(r.originalIncomeInterest),
          originalRemainderInterest: Number(r.originalRemainderInterest),
        },
      ]),
    );

    const mappedEntities = entityRows.map((e) => ({
      id: e.id,
      name: e.name,
      entityType: e.entityType ?? undefined,
      includeInPortfolio: e.includeInPortfolio,
      accessibleToClient: e.accessibleToClient,
      isGrantor: e.isGrantor,
      crummeyPowers: e.crummeyPowers,
      grantorStatusEndYear: e.grantorStatusEndYear ?? undefined,
      beneficiaries: trustBens.get(e.id) ?? undefined,
      // `revocable` is a deprecated DB-enum orphan (revocable trusts are now a
      // tag, not an entity) and is no longer part of the TrustSubType union.
      // Legacy rows may still carry it; map it to undefined so the engine sees a
      // valid subtype. The engine's revocable behavior keys off isIrrevocable,
      // which is loaded faithfully below, so dropping the cosmetic subtype is safe.
      trustSubType:
        e.trustSubType != null && e.trustSubType !== "revocable"
          ? e.trustSubType
          : undefined,
      isIrrevocable: e.isIrrevocable ?? undefined,
      trustee: e.trustee ?? undefined,
      exemptionConsumed: exemptionByEntity.get(e.id) ?? 0,
      grantor: e.grantor ?? undefined,
      distributionMode: e.distributionMode ?? undefined,
      distributionAmount: e.distributionAmount != null ? parseFloat(e.distributionAmount) : undefined,
      distributionPercent: e.distributionPercent != null ? parseFloat(e.distributionPercent) : undefined,
      taxTreatment: e.taxTreatment ?? undefined,
      distributionPolicyPercent:
        e.distributionPolicyPercent != null
          ? parseFloat(e.distributionPolicyPercent)
          : undefined,
      flowMode: e.flowMode ?? "annual",
      valueGrowthRate:
        e.valueGrowthRate != null ? parseFloat(e.valueGrowthRate) : undefined,
      incomeBeneficiaries: incomeByEntity.get(e.id) ?? [],
      remainderBeneficiaries: remainderByEntity.get(e.id) ?? [],
      trustEnds: e.trustEnds ?? null,
      value: e.value != null ? parseFloat(e.value) : undefined,
      basis: e.basis != null ? parseFloat(e.basis) : undefined,
      owners: ownersByEntity.get(e.id),
      splitInterest: splitInterestByEntityId.get(e.id),
    }));

    const mappedExternalBeneficiaries = externalBeneficiaryRows.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      charityType: r.charityType,
    }));

    const mappedTransfers = transferRows.map((t) => {
      const schedules = transferScheduleRows
        .filter((s) => s.transferId === t.id)
        .map((s) => ({ year: s.year, amount: parseFloat(s.amount) }));
      const resolvedTransferEnd = t.endYear == null
        ? undefined
        : resolvedEnd(t.endYearRef ?? null, t.endYear);
      return {
        id: t.id,
        name: t.name,
        sourceAccountId: t.sourceAccountId,
        targetAccountId: t.targetAccountId,
        amount: parseFloat(t.amount),
        mode: t.mode,
        startYear: resolvedStart(t.startYearRef ?? null, t.startYear),
        endYear: resolvedTransferEnd,
        growthRate: parseFloat(t.growthRate),
        schedules,
        startYearRef: t.startYearRef ?? null,
        endYearRef: t.endYearRef ?? null,
      };
    });

    // ── Reinvestments ───────────────────────────────────────────────────────
    // Build raw-shaped reinvestment entries (carrying BOTH the raw resolution
    // inputs — modelPortfolioId / customGrowthRate / customPct* — and the
    // placeholder resolved fields), then resolve them via the shared
    // `resolveReinvestments`. Carrying the raw inputs lets `lookupBaseEntity`
    // (which reads the effective base tree) produce a correct raw-keyed diff
    // for scenario edits, and lets the scenario overlay re-resolve.

    // Group-target expansion context (live group reference). Default keys
    // expand from account category; custom UUIDs from their liquid members.
    const accountCategoryById = new Map<string, AccountCategory>(
      accountRows.map((a) => [a.id, a.category as AccountCategory]),
    );
    const customGroupMembersById = new Map<string, string[]>();
    for (const m of accountGroupMemberRows) {
      const cat = accountCategoryById.get(m.accountId);
      if (cat == null || !isLiquid(cat)) continue; // groups are liquid-only
      const list = customGroupMembersById.get(m.accountGroupId) ?? [];
      list.push(m.accountId);
      customGroupMembersById.set(m.accountGroupId, list);
    }

    const rawReinvestments: Reinvestment[] = reinvestmentRows.map((r) => {
      const individualAccountIds = reinvestmentAccountRows
        .filter((ra) => ra.reinvestmentId === r.id)
        .map((ra) => ra.accountId);
      const groupKeys = reinvestmentGroupRows
        .filter((rg) => rg.reinvestmentId === r.id)
        .map((rg) => rg.groupKey);
      const accountIds = expandReinvestmentTargets(individualAccountIds, groupKeys, {
        accountCategoryById,
        customGroupMembersById,
      });
      return {
        id: r.id,
        name: r.name,
        accountIds,
        groupKeys,
        year: resolvedStart(r.yearRef ?? null, r.year),
        // Resolved fields — (re)computed by resolveReinvestments below.
        newGrowthRate: 0,
        newRealization: undefined,
        realizeTaxesOnSwitch: r.realizeTaxesOnSwitch,
        soldFractionByAccount: {},
        yearRef: r.yearRef ?? null,
        targetType: r.targetType,
        // Raw resolution inputs.
        modelPortfolioId: r.modelPortfolioId,
        customGrowthRate:
          r.customGrowthRate != null ? parseFloat(r.customGrowthRate) : null,
        customPctOrdinaryIncome:
          r.customPctOrdinaryIncome != null
            ? parseFloat(r.customPctOrdinaryIncome)
            : null,
        customPctLtCapitalGains:
          r.customPctLtCapitalGains != null
            ? parseFloat(r.customPctLtCapitalGains)
            : null,
        customPctQualifiedDividends:
          r.customPctQualifiedDividends != null
            ? parseFloat(r.customPctQualifiedDividends)
            : null,
        customPctTaxExempt:
          r.customPctTaxExempt != null ? parseFloat(r.customPctTaxExempt) : null,
      } satisfies Reinvestment;
    });

    const mappedReinvestments = resolveReinvestments(rawReinvestments, {
      resolver,
      accountBaseAllocByAccountId,
    });

    const mappedRothConversions = rothConversionRows.map((c) => {
      const sources = rothConversionSourceRows
        .filter((s) => s.rothConversionId === c.id)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((s) => s.accountId);
      const resolvedConvEnd = c.endYear == null
        ? undefined
        : resolvedEnd(c.endYearRef ?? null, c.endYear);
      return {
        id: c.id,
        name: c.name,
        destinationAccountId: c.destinationAccountId,
        sourceAccountIds: sources,
        conversionType: c.conversionType,
        fixedAmount: parseFloat(c.fixedAmount),
        fillUpBracket: c.fillUpBracket != null ? parseFloat(c.fillUpBracket) : undefined,
        startYear: resolvedStart(c.startYearRef ?? null, c.startYear),
        endYear: resolvedConvEnd,
        indexingRate: parseFloat(c.indexingRate),
        inflationStartYear: c.inflationStartYear ?? undefined,
        startYearRef: c.startYearRef ?? null,
        endYearRef: c.endYearRef ?? null,
      };
    });

    const mappedAssetTransactions = assetTransactionRows.map((t) => ({
      id: t.id,
      name: t.name,
      type: t.type,
      year: t.year,
      accountId: t.accountId ?? undefined,
      overrideSaleValue: t.overrideSaleValue ? parseFloat(t.overrideSaleValue) : undefined,
      overrideBasis: t.overrideBasis ? parseFloat(t.overrideBasis) : undefined,
      transactionCostPct: t.transactionCostPct ? parseFloat(t.transactionCostPct) : undefined,
      transactionCostFlat: t.transactionCostFlat ? parseFloat(t.transactionCostFlat) : undefined,
      proceedsAccountId: t.proceedsAccountId ?? undefined,
      qualifiesForHomeSaleExclusion: t.qualifiesForHomeSaleExclusion,
      purchaseTransactionId: t.purchaseTransactionId ?? null,
      fractionSold: t.fractionSold !== null ? Number(t.fractionSold) : null,
      assetName: t.assetName ?? undefined,
      assetCategory: t.assetCategory ?? undefined,
      assetSubType: t.assetSubType ?? undefined,
      purchasePrice: t.purchasePrice ? parseFloat(t.purchasePrice) : undefined,
      growthRate: t.growthRate ? parseFloat(t.growthRate) : undefined,
      basis: t.basis ? parseFloat(t.basis) : undefined,
      fundingAccountId: t.fundingAccountId ?? undefined,
      mortgageAmount: t.mortgageAmount ? parseFloat(t.mortgageAmount) : undefined,
      mortgageRate: t.mortgageRate ? parseFloat(t.mortgageRate) : undefined,
      mortgageTermMonths: t.mortgageTermMonths ?? undefined,
    }));

    // Legacy `gifts: Gift[]` array consumed by computeAdjustedTaxableGifts.
    // Restricted to cash-only rows (amount NOT NULL, no asset/liability link)
    // — asset/liability gifts flow through `giftEvents` instead and are
    // valued at projection time via T11's `accountValueAtYear × percent`.
    // Without this filter, asset rows would reach the estate-tax calc as $0
    // and silently drop from lifetime exemption consumption.
    const mappedGifts = giftRows
      .filter(
        (g) =>
          g.amount != null &&
          g.accountId == null &&
          g.liabilityId == null &&
          g.businessEntityId == null,
      )
      .map((g) => ({
        id: g.id,
        year: g.year,
        amount: parseFloat(g.amount!),
        grantor: g.grantor,
        recipientEntityId: g.recipientEntityId ?? undefined,
        recipientFamilyMemberId: g.recipientFamilyMemberId ?? undefined,
        recipientExternalBeneficiaryId: g.recipientExternalBeneficiaryId ?? undefined,
        useCrummeyPowers: g.useCrummeyPowers,
      }));

    // ── Build giftEvents (discriminated union) ───────────────────────────────
    const cpi = resolvedInflationRate;

    const cashFromGifts: GiftEvent[] = giftRows
      .filter(
        (g) =>
          g.amount != null &&
          g.accountId == null &&
          g.liabilityId == null &&
          g.businessEntityId == null,
      )
      .map((g) => ({
        kind: "cash" as const,
        year: g.year,
        amount: Number(g.amount),
        grantor: g.grantor as "client" | "spouse",
        // Null for gifts to family members / external beneficiaries — the
        // engine debits the household source either way; only a trust recipient
        // gets an offsetting credit.
        recipientEntityId: g.recipientEntityId ?? undefined,
        useCrummeyPowers: g.useCrummeyPowers ?? false,
        eventKind: g.eventKind,
      }));

    const assetFromGifts: GiftEvent[] = giftRows
      .filter((g) => g.accountId != null)
      .map((g) => ({
        kind: "asset" as const,
        year: g.year,
        accountId: g.accountId!,
        percent: Number(g.percent),
        grantor: g.grantor as "client" | "spouse",
        recipientEntityId: g.recipientEntityId!,
        amountOverride: g.amount != null ? Number(g.amount) : undefined,
        eventKind: g.eventKind,
      }));

    const liabilityFromGifts: GiftEvent[] = giftRows
      .filter((g) => g.liabilityId != null)
      .map((g) => ({
        kind: "liability" as const,
        year: g.year,
        liabilityId: g.liabilityId!,
        percent: Number(g.percent),
        grantor: g.grantor as "client" | "spouse",
        recipientEntityId: g.recipientEntityId!,
        parentGiftId: g.parentGiftId!,
        eventKind: g.eventKind,
      }));

    const businessInterestFromGifts: GiftEvent[] = giftRows
      .filter((g) => g.businessEntityId != null)
      .map((g) => ({
        kind: "business_interest" as const,
        year: g.year,
        entityId: g.businessEntityId!,
        percent: Number(g.percent),
        grantor: g.grantor as "client" | "spouse",
        recipientEntityId: g.recipientEntityId!,
        amountOverride: g.amount != null ? Number(g.amount) : undefined,
        eventKind: g.eventKind,
      }));

    // Same inputs the gift-ledger uses, so annual_exclusion series net to
    // exactly $0 taxable. The blank-taxInflation fallback must match the engine's
    // planSettings.inflationRate (the resolved rate), not the raw column, or the
    // net-$0 invariant breaks when source = "asset_class".
    const giftExclusionByYear = buildAnnualExclusionMap(
      parsedTaxRows,
      settings.planStartYear,
      settings.planEndYear,
      settings.taxInflationRate != null
        ? parseFloat(settings.taxInflationRate)
        : resolvedInflationRate,
    );

    const seriesEvents: GiftEvent[] = giftSeriesRows.flatMap((s) =>
      fanOutGiftSeries(
        {
          id: s.id,
          grantor: s.grantor as "client" | "spouse" | "joint",
          recipientEntityId: s.recipientEntityId,
          startYear: s.startYear,
          endYear: s.endYear,
          annualAmount: Number(s.annualAmount),
          amountMode: (s.amountMode ?? "fixed") as "fixed" | "annual_exclusion",
          inflationAdjust: s.inflationAdjust,
          useCrummeyPowers: s.useCrummeyPowers,
        },
        { cpi, exclusionByYear: giftExclusionByYear },
      ),
    );

    const giftEvents: GiftEvent[] = [
      ...cashFromGifts,
      ...assetFromGifts,
      ...liabilityFromGifts,
      ...businessInterestFromGifts,
      ...seriesEvents,
    ].sort((a, b) => a.year - b.year);

    const mappedFamilyMembers = familyMemberRows.map((f) => ({
      id: f.id,
      role: f.role,
      relationship: f.relationship,
      firstName: f.firstName,
      lastName: f.lastName ?? null,
      dateOfBirth: f.dateOfBirth ?? null,
      domesticPartner: f.domesticPartner,
      inheritanceClassOverride: f.inheritanceClassOverride ?? {},
    }));

    const clientInfo = {
      firstName: clientFirstName,
      lastName: clientLastName,
      dateOfBirth: clientDob,
      retirementAge: client.retirementAge,
      retirementMonth: client.retirementMonth ?? 1,
      planEndAge: client.planEndAge,
      lifeExpectancy: client.lifeExpectancy,
      spouseName: spouseFirstName,
      spouseDob: spouseDob,
      spouseRetirementAge: client.spouseRetirementAge ?? undefined,
      spouseRetirementMonth: client.spouseRetirementMonth ?? undefined,
      spouseLifeExpectancy: client.spouseLifeExpectancy ?? null,
      filingStatus: client.filingStatus,
    };

    // Base-plan overrides (scenario_id IS NULL). Scenario-specific overrides
    // are layered in by `loadEffectiveTree` for non-base scenarios.
    const entityIds = mappedEntities.map((e) => e.id);
    const flowOverrideRows = entityIds.length === 0
      ? []
      : await db
          .select({
            entityId: entityFlowOverrides.entityId,
            year: entityFlowOverrides.year,
            incomeAmount: entityFlowOverrides.incomeAmount,
            expenseAmount: entityFlowOverrides.expenseAmount,
            distributionPercent: entityFlowOverrides.distributionPercent,
          })
          .from(entityFlowOverrides)
          .where(
            and(
              inArray(entityFlowOverrides.entityId, entityIds),
              isNull(entityFlowOverrides.scenarioId),
            ),
          );

    const mappedFlowOverrides: EntityFlowOverride[] = flowOverrideRows.map((r) => ({
      entityId: r.entityId,
      year: r.year,
      incomeAmount: r.incomeAmount != null ? parseFloat(r.incomeAmount) : null,
      expenseAmount: r.expenseAmount != null ? parseFloat(r.expenseAmount) : null,
      distributionPercent:
        r.distributionPercent != null ? parseFloat(r.distributionPercent) : null,
    }));

    // Business-as-asset per-year overrides — top-level business accounts only.
    // Scenario-specific overrides are layered in by `loadEffectiveTree`.
    const businessAccountIds = mappedAccounts
      .filter((a) => a.category === "business" && a.parentAccountId == null)
      .map((a) => a.id);
    const accountFlowOverrideRows = businessAccountIds.length === 0
      ? []
      : await db
          .select({
            accountId: accountFlowOverrides.accountId,
            year: accountFlowOverrides.year,
            incomeAmount: accountFlowOverrides.incomeAmount,
            expenseAmount: accountFlowOverrides.expenseAmount,
            distributionPercent: accountFlowOverrides.distributionPercent,
          })
          .from(accountFlowOverrides)
          .where(
            and(
              inArray(accountFlowOverrides.accountId, businessAccountIds),
              isNull(accountFlowOverrides.scenarioId),
            ),
          );

    const mappedAccountFlowOverrides: AccountFlowOverride[] = accountFlowOverrideRows.map((r) => ({
      accountId: r.accountId,
      year: r.year,
      incomeAmount: r.incomeAmount != null ? parseFloat(r.incomeAmount) : null,
      expenseAmount: r.expenseAmount != null ? parseFloat(r.expenseAmount) : null,
      distributionPercent:
        r.distributionPercent != null ? parseFloat(r.distributionPercent) : null,
    }));

    // ── Stock-option plans (equity comp) ───────────────────────────────────
    // Resolve the spouse's family member id (role = 'spouse') so we can detect
    // which stock_options accounts belong to the spouse vs. the client.
    const spouseFamilyMemberId = familyMemberRows.find((f) => f.role === "spouse")?.id ?? null;
    const soOwnerByAccount: Record<string, "client" | "spouse"> = {};
    const soGrowthByAccount: Record<string, number> = {};
    for (const a of mappedAccounts) {
      if (a.category !== "stock_options") continue;
      soGrowthByAccount[a.id] = a.growthRate;
      // Equity is single-owner; first family_member owner wins.
      const firstOwner = a.owners.find((o) => o.kind === "family_member");
      soOwnerByAccount[a.id] =
        spouseFamilyMemberId != null &&
        firstOwner?.kind === "family_member" &&
        firstOwner.familyMemberId === spouseFamilyMemberId
          ? "spouse"
          : "client";
    }
    const stockOptionPlans = await loadStockOptionPlans(id, scenario.id, soGrowthByAccount, soOwnerByAccount);

    const clientData: ClientData = {
      client: clientInfo,
      accounts: mappedAccounts,
      incomes: mappedIncomes,
      expenses: mappedExpenses,
      liabilities: mappedLiabilities,
      savingsRules: mappedSavingsRules,
      withdrawalStrategy: mappedWithdrawalStrategy,
      planSettings: mappedPlanSettings,
      entities: mappedEntities,
      entityFlowOverrides: mappedFlowOverrides,
      accountFlowOverrides: mappedAccountFlowOverrides,
      externalBeneficiaries: mappedExternalBeneficiaries,
      taxYearRows: parsedTaxRows,
      deductions: parsedDeductions,
      transfers: mappedTransfers,
      reinvestments: mappedReinvestments,
      rothConversions: mappedRothConversions,
      assetTransactions: mappedAssetTransactions,
      stockOptionPlans,
      gifts: mappedGifts,
      giftEvents,
      wills: engineWills,
      familyMembers: mappedFamilyMembers,
      notesReceivable: await loadNotesReceivable(id, scenario.id),
      medicareCoverage: medicareCoverageRows.map(rowToMedicareCoverage),
      medicarePremiumInflationRate: settings.medicarePremiumInflationRate != null
        ? parseFloat(settings.medicarePremiumInflationRate)
        : DEFAULT_MEDICARE_PREMIUM_INFLATION_RATE,
      medicarePremiumInflationEnabled: settings.medicarePremiumInflationEnabled,
    };

    return {
      clientData: withSynthesizedPremiumGifts(
        withSynthesizedPolicyIncome(withSynthesizedPremiums(clientData)),
      ),
      resolutionContext: resolutionCtx,
    };
  },
);

export async function loadClientData(
  clientId: string,
  firmId: string,
): Promise<ClientData> {
  const { clientData } = await loadClientDataWithContext(clientId, firmId);
  return clientData;
}

import { cache } from "react";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  accountAssetAllocations,
  accountOwners,
  assetClasses,
  assetTransactions,
  beneficiaryDesignations,
  clientCmaOverrides,
  clientDeductions,
  clients,
  entities,
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
  rothConversions,
  rothConversionSources,
  transfers,
  transferSchedules,
  willBequestRecipients,
  willBequests,
  willResiduaryRecipients,
  wills,
  withdrawalStrategies,
} from "@/db/schema";
import type {
  BeneficiaryRef,
  ClientData,
  GiftEvent,
  Will,
  WillBequest,
  WillResiduaryRecipient,
} from "@/engine/types";
import { fanOutGiftSeries } from "@/engine/series-fanout";
import type { AccountOwner } from "@/engine/ownership";
import { dbRowToTaxYearParameters } from "@/lib/tax/dbMapper";
import { resolveInflationRate } from "@/lib/inflation";
import { buildClientMilestones, resolveMilestone, type YearRef } from "@/lib/milestones";
import { loadPoliciesByAccountIds } from "@/lib/insurance-policies/load-policies";
import { synthesizePremiumExpenses } from "@/lib/insurance-policies/premium-expense";
import { createGrowthSourceResolver } from "./resolve-growth-source";

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

export const loadClientData = cache(
  async (clientId: string, firmId: string): Promise<ClientData> => {
    // Verify client access
    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));

    if (!client) {
      throw new ClientNotFoundError(clientId);
    }

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
      rothConversionRows,
      rothConversionSourceRows,
      assetTransactionRows,
      giftRows,
      familyMemberRows,
      externalBeneficiaryRows,
      giftSeriesRows,
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
    ]);

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
      client,
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
      const owner: AccountOwner = r.familyMemberId
        ? { kind: "family_member", familyMemberId: r.familyMemberId, percent: parseFloat(r.percent) }
        : { kind: "entity", entityId: r.entityId!, percent: parseFloat(r.percent) };
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

    // Resolve the household's effective inflation rate for per-row "grow at inflation"
    // consumers (accounts, income, expenses, savings rules). NOTE: the projection
    // engine's tax-bracket indexing and SS-wage-growth fallback paths still read the
    // raw planSettings.inflationRate decimal directly, which can diverge from this
    // resolved value when source = "asset_class". Aligning those is tracked in
    // docs/FUTURE_WORK.md ("Align plan_settings.inflation_rate consumers with the
    // resolver").
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
    });

    // Helper to get the category-level growth source string from plan_settings
    function getCategoryGrowthSource(category: string): string {
      const sourceLookup: Record<string, string> = {
        taxable: settings.growthSourceTaxable,
        cash: settings.growthSourceCash,
        retirement: settings.growthSourceRetirement,
      };
      return sourceLookup[category] ?? "custom";
    }

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

    // ── Build ClientData ────────────────────────────────────────────────────

    // Convert Drizzle decimal strings to numbers for the engine

    const mappedAccounts = accountRows.map((a) => {
      let growthRate: number;
      let realization:
        | {
            pctOrdinaryIncome: number;
            pctLtCapitalGains: number;
            pctQualifiedDividends: number;
            pctTaxExempt: number;
            turnoverPct: number;
          }
        | undefined;

      const gs = a.growthSource ?? "default";

      // Determine effective growth source (category default may point to asset_mix)
      let effectiveSource = gs;
      if (effectiveSource === "default") {
        const catSource = getCategoryGrowthSource(a.category);
        if (catSource === "asset_mix") {
          effectiveSource = "asset_mix";
        }
      }

      if (effectiveSource === "inflation") {
        growthRate = resolvedInflationRate;
      } else if (effectiveSource === "model_portfolio" && a.modelPortfolioId) {
        const p = resolver.resolvePortfolio(a.modelPortfolioId);
        growthRate = p.geoReturn;
        realization = {
          pctOrdinaryIncome: a.overridePctOi != null ? parseFloat(a.overridePctOi) : p.pctOi,
          pctLtCapitalGains: a.overridePctLtCg != null ? parseFloat(a.overridePctLtCg) : p.pctLtcg,
          pctQualifiedDividends: a.overridePctQdiv != null ? parseFloat(a.overridePctQdiv) : p.pctQdiv,
          pctTaxExempt: a.overridePctTaxExempt != null ? parseFloat(a.overridePctTaxExempt) : p.pctTaxEx,
          turnoverPct: parseFloat(a.turnoverPct ?? "0"),
        };
      } else if (effectiveSource === "asset_mix") {
        const resolved = resolver.resolveAccountMix(a.id);
        growthRate = resolved.geoReturn;
        realization = {
          pctOrdinaryIncome: a.overridePctOi != null ? parseFloat(a.overridePctOi) : resolved.pctOi,
          pctLtCapitalGains: a.overridePctLtCg != null ? parseFloat(a.overridePctLtCg) : resolved.pctLtcg,
          pctQualifiedDividends: a.overridePctQdiv != null ? parseFloat(a.overridePctQdiv) : resolved.pctQdiv,
          pctTaxExempt: a.overridePctTaxExempt != null ? parseFloat(a.overridePctTaxExempt) : resolved.pctTaxEx,
          turnoverPct: parseFloat(a.turnoverPct ?? "0"),
        };
      } else if (effectiveSource === "custom" && a.growthRate != null) {
        growthRate = parseFloat(a.growthRate);
      } else {
        // "default" — resolve from category default in plan_settings
        const catDefault = resolver.resolveCategoryDefault(a.category);
        growthRate = catDefault.rate;
        realization = catDefault.realization;
      }

      // Cash accounts: always 100% OI regardless of portfolio
      if (a.category === "cash") {
        realization = { pctOrdinaryIncome: 1, pctLtCapitalGains: 0, pctQualifiedDividends: 0, pctTaxExempt: 0, turnoverPct: 0 };
      }

      // Retirement accounts: growth is tax-deferred (pre-tax) or tax-free (Roth).
      // Withdrawals are taxed as OI by the existing withdrawal logic. No per-year
      // realization split applies.
      if (a.category === "retirement") {
        realization = undefined;
      }

      // Non-investable categories: no realization, use flat defaults
      if (["real_estate", "business", "life_insurance"].includes(a.category)) {
        const flatDefaults: Record<string, string> = {
          real_estate: String(settings.defaultGrowthRealEstate),
          business: String(settings.defaultGrowthBusiness),
          life_insurance: String(settings.defaultGrowthLifeInsurance),
        };
        growthRate = a.growthRate != null ? parseFloat(a.growthRate) : parseFloat(flatDefaults[a.category] ?? "0.04");
        realization = undefined;
      }

      return {
        id: a.id,
        name: a.name,
        category: a.category,
        subType: a.subType,
        value: parseFloat(a.value),
        basis: parseFloat(a.basis),
        growthRate,
        rmdEnabled: a.rmdEnabled,
        priorYearEndValue: a.priorYearEndValue != null ? parseFloat(a.priorYearEndValue) : undefined,
        beneficiaries: accountBens.get(a.id) ?? undefined,
        isDefaultChecking: a.isDefaultChecking,
        realization,
        annualPropertyTax: parseFloat(a.annualPropertyTax),
        propertyTaxGrowthRate: parseFloat(a.propertyTaxGrowthRate),
        insuredPerson: a.insuredPerson ?? undefined,
        lifeInsurance: policiesByAccount[a.id],
        owners: ownersByAccountId.get(a.id) ?? [],
      };
    });

    const mappedIncomes = incomeRows.map((i) => ({
      id: i.id,
      type: i.type,
      name: i.name,
      annualAmount: parseFloat(i.annualAmount),
      startYear: resolvedStart(i.startYearRef, i.startYear),
      endYear: resolvedEnd(i.endYearRef, i.endYear),
      growthRate: i.growthSource === "inflation" ? resolvedInflationRate : parseFloat(i.growthRate),
      owner: i.owner,
      claimingAge: i.claimingAge ?? undefined,
      linkedEntityId: i.linkedEntityId ?? undefined,
      ownerEntityId: i.ownerEntityId ?? undefined,
      cashAccountId: i.cashAccountId ?? undefined,
      inflationStartYear: i.inflationStartYear ?? undefined,
      taxType: i.taxType ?? undefined,
      ssBenefitMode: (i.ssBenefitMode as "manual_amount" | "pia_at_fra" | "no_benefit" | null) ?? undefined,
      piaMonthly: i.piaMonthly != null ? parseFloat(i.piaMonthly) : undefined,
      claimingAgeMonths: i.claimingAgeMonths ?? 0,
      claimingAgeMode: (i.claimingAgeMode as "years" | "fra" | "at_retirement" | null) ?? undefined,
      scheduleOverrides: incomeOverrideMap.get(i.id),
      startYearRef: i.startYearRef ?? null,
      endYearRef: i.endYearRef ?? null,
      growthSource: i.growthSource ?? null,
    }));

    const mappedExpenses = expenseRows.map((e) => ({
      id: e.id,
      type: e.type,
      name: e.name,
      annualAmount: parseFloat(e.annualAmount),
      startYear: resolvedStart(e.startYearRef, e.startYear),
      endYear: resolvedEnd(e.endYearRef, e.endYear),
      growthRate: e.growthSource === "inflation" ? resolvedInflationRate : parseFloat(e.growthRate),
      ownerEntityId: e.ownerEntityId ?? undefined,
      cashAccountId: e.cashAccountId ?? undefined,
      inflationStartYear: e.inflationStartYear ?? undefined,
      deductionType: e.deductionType ?? undefined,
      scheduleOverrides: expenseOverrideMap.get(e.id),
      startYearRef: e.startYearRef ?? null,
      endYearRef: e.endYearRef ?? null,
      growthSource: e.growthSource ?? null,
    }));

    // Synthesize life-insurance premium expenses and merge with the mapped list.
    const clientBirthYear = parseInt(client.dateOfBirth.slice(0, 4), 10);
    const spouseBirthYear = client.spouseDob
      ? parseInt(client.spouseDob.slice(0, 4), 10)
      : null;
    const syntheticPremiums = synthesizePremiumExpenses({
      currentYear: new Date().getFullYear(),
      accounts: mappedAccounts,
      clientBirthYear,
      spouseBirthYear,
      clientRetirementAge: client.retirementAge,
      spouseRetirementAge: client.spouseRetirementAge ?? null,
      lifeExpectancyClient: client.lifeExpectancy,
      lifeExpectancySpouse: client.spouseLifeExpectancy,
    });
    const allExpenses = [...mappedExpenses, ...syntheticPremiums];

    const mappedLiabilities = liabilityRows.map((l) => ({
      id: l.id,
      name: l.name,
      balance: parseFloat(l.balance),
      interestRate: parseFloat(l.interestRate),
      monthlyPayment: parseFloat(l.monthlyPayment),
      startYear: l.startYear,
      startMonth: l.startMonth,
      termMonths: l.termMonths,
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
    }));

    const mappedSavingsRules = savingsRuleRows.map((s) => ({
      id: s.id,
      accountId: s.accountId,
      annualAmount: parseFloat(s.annualAmount),
      annualPercent: s.annualPercent != null ? parseFloat(s.annualPercent) : null,
      isDeductible: s.isDeductible,
      applyContributionLimit: s.applyContributionLimit,
      contributeMax: s.contributeMax,
      startYear: resolvedStart(s.startYearRef, s.startYear),
      endYear: resolvedEnd(s.endYearRef, s.endYear),
      growthRate: s.growthSource === "inflation" ? resolvedInflationRate : Number(s.growthRate ?? 0),
      employerMatchPct: s.employerMatchPct != null ? parseFloat(s.employerMatchPct) : undefined,
      employerMatchCap: s.employerMatchCap != null ? parseFloat(s.employerMatchCap) : undefined,
      employerMatchAmount:
        s.employerMatchAmount != null ? parseFloat(s.employerMatchAmount) : undefined,
      scheduleOverrides: savingsOverrideMap.get(s.id),
      startYearRef: s.startYearRef ?? null,
      endYearRef: s.endYearRef ?? null,
      growthSource: s.growthSource ?? null,
    }));

    const mappedWithdrawalStrategy = withdrawalRows.map((w) => ({
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
      inflationRate: parseFloat(settings.inflationRate),
      planStartYear: settings.planStartYear,
      planEndYear: settings.planEndYear,
      taxEngineMode: settings.taxEngineMode,
      taxInflationRate: settings.taxInflationRate != null ? parseFloat(settings.taxInflationRate) : null,
      ssWageGrowthRate: settings.ssWageGrowthRate != null ? parseFloat(settings.ssWageGrowthRate) : null,
      outOfHouseholdRate: settings.outOfHouseholdDniRate != null ? parseFloat(settings.outOfHouseholdDniRate) : undefined,
      priorTaxableGifts: {
        client: settings.priorTaxableGiftsClient != null ? parseFloat(settings.priorTaxableGiftsClient) : 0,
        spouse: settings.priorTaxableGiftsSpouse != null ? parseFloat(settings.priorTaxableGiftsSpouse) : 0,
      },
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

    // ── exemptionConsumed derived from gifts to each entity ──────────────────
    const exemptionByEntity = new Map<string, number>();
    for (const g of giftRows) {
      if (!g.recipientEntityId) continue;
      exemptionByEntity.set(
        g.recipientEntityId,
        (exemptionByEntity.get(g.recipientEntityId) ?? 0) + Number(g.amount),
      );
    }

    const mappedEntities = entityRows.map((e) => ({
      id: e.id,
      name: e.name,
      entityType: e.entityType ?? undefined,
      includeInPortfolio: e.includeInPortfolio,
      isGrantor: e.isGrantor,
      beneficiaries: trustBens.get(e.id) ?? undefined,
      trustSubType: e.trustSubType ?? undefined,
      isIrrevocable: e.isIrrevocable ?? undefined,
      trustee: e.trustee ?? undefined,
      exemptionConsumed: exemptionByEntity.get(e.id) ?? 0,
      grantor: e.grantor ?? undefined,
      distributionMode: e.distributionMode ?? undefined,
      distributionAmount: e.distributionAmount != null ? parseFloat(e.distributionAmount) : undefined,
      distributionPercent: e.distributionPercent != null ? parseFloat(e.distributionPercent) : undefined,
      incomeBeneficiaries: incomeByEntity.get(e.id) ?? [],
      trustEnds: e.trustEnds ?? null,
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
      .filter((g) => g.amount != null && g.accountId == null && g.liabilityId == null)
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
      .filter((g) => g.amount != null && g.accountId == null && g.liabilityId == null)
      .map((g) => ({
        kind: "cash" as const,
        year: g.year,
        amount: Number(g.amount),
        grantor: g.grantor as "client" | "spouse",
        recipientEntityId: g.recipientEntityId!,
        useCrummeyPowers: g.useCrummeyPowers ?? false,
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
      }));

    const seriesEvents: GiftEvent[] = giftSeriesRows.flatMap((s) =>
      fanOutGiftSeries(
        {
          id: s.id,
          grantor: s.grantor as "client" | "spouse",
          recipientEntityId: s.recipientEntityId,
          startYear: s.startYear,
          endYear: s.endYear,
          annualAmount: Number(s.annualAmount),
          inflationAdjust: s.inflationAdjust,
          useCrummeyPowers: s.useCrummeyPowers,
        },
        { cpi },
      ),
    );

    const giftEvents: GiftEvent[] = [
      ...cashFromGifts,
      ...assetFromGifts,
      ...liabilityFromGifts,
      ...seriesEvents,
    ].sort((a, b) => a.year - b.year);

    const mappedFamilyMembers = familyMemberRows.map((f) => ({
      id: f.id,
      role: f.role,
      relationship: f.relationship,
      firstName: f.firstName,
      lastName: f.lastName ?? null,
      dateOfBirth: f.dateOfBirth ?? null,
    }));

    const clientInfo = {
      firstName: client.firstName,
      lastName: client.lastName,
      dateOfBirth: client.dateOfBirth,
      retirementAge: client.retirementAge,
      planEndAge: client.planEndAge,
      lifeExpectancy: client.lifeExpectancy,
      spouseName: client.spouseName ?? undefined,
      spouseDob: client.spouseDob ?? undefined,
      spouseRetirementAge: client.spouseRetirementAge ?? undefined,
      spouseLifeExpectancy: client.spouseLifeExpectancy ?? null,
      filingStatus: client.filingStatus,
    };

    return {
      client: clientInfo,
      accounts: mappedAccounts,
      incomes: mappedIncomes,
      expenses: allExpenses,
      liabilities: mappedLiabilities,
      savingsRules: mappedSavingsRules,
      withdrawalStrategy: mappedWithdrawalStrategy,
      planSettings: mappedPlanSettings,
      entities: mappedEntities,
      externalBeneficiaries: mappedExternalBeneficiaries,
      taxYearRows: parsedTaxRows,
      deductions: parsedDeductions,
      transfers: mappedTransfers,
      rothConversions: mappedRothConversions,
      assetTransactions: mappedAssetTransactions,
      gifts: mappedGifts,
      giftEvents,
      wills: engineWills,
      familyMembers: mappedFamilyMembers,
    };
  },
);

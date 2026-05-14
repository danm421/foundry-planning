import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  assetClasses,
  clientCmaOverrides,
  clients,
  entities,
  entityOwners,
  familyMembers,
  liabilities,
  modelPortfolioAllocations,
  modelPortfolios,
  planSettings,
  scenarios,
} from "@/db/schema";
import type { AccountRow, LiabilityRow } from "@/components/balance-sheet-view";
import { buildClientMilestones } from "@/lib/milestones";
import { resolveInflationRate } from "@/lib/inflation";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { controllingEntity, controllingFamilyMember } from "@/engine/ownership";

/** Bundle of props the wizard's Accounts and Liabilities steps both need.
 * Mirrors the standard balance-sheet page loader at
 * `src/app/(app)/clients/[id]/client-data/balance-sheet/page.tsx`.
 *
 * Kept as a single helper because Accounts and Liabilities are sibling
 * wizard steps over the same underlying view — duplicating the loader would
 * be 150+ lines of drift risk for zero benefit. */
export async function loadBalanceSheetStepData(clientId: string, firmId: string) {
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  if (!client) return null;

  const [scenario] = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)));
  if (!scenario) return null;

  const [
    accountMetaRows,
    liabilityMetaRows,
    entityRows,
    familyMemberRows,
    settingsRows,
    portfolioRows,
    allocationRows,
    assetClassRows,
    { effectiveTree },
  ] = await Promise.all([
    db
      .select({
        id: accounts.id,
        growthSource: accounts.growthSource,
        modelPortfolioId: accounts.modelPortfolioId,
        turnoverPct: accounts.turnoverPct,
        overridePctOi: accounts.overridePctOi,
        overridePctLtCg: accounts.overridePctLtCg,
        overridePctQdiv: accounts.overridePctQdiv,
        overridePctTaxExempt: accounts.overridePctTaxExempt,
        annualPropertyTax: accounts.annualPropertyTax,
        propertyTaxGrowthRate: accounts.propertyTaxGrowthRate,
        propertyTaxGrowthSource: accounts.propertyTaxGrowthSource,
      })
      .from(accounts)
      .where(and(eq(accounts.clientId, clientId), eq(accounts.scenarioId, scenario.id))),
    db
      .select({ id: liabilities.id, termUnit: liabilities.termUnit })
      .from(liabilities)
      .where(and(eq(liabilities.clientId, clientId), eq(liabilities.scenarioId, scenario.id))),
    db.select().from(entities).where(eq(entities.clientId, clientId)).orderBy(asc(entities.name)),
    db
      .select({ id: familyMembers.id, role: familyMembers.role, firstName: familyMembers.firstName })
      .from(familyMembers)
      .where(eq(familyMembers.clientId, clientId))
      .orderBy(asc(familyMembers.role), asc(familyMembers.firstName)),
    db
      .select()
      .from(planSettings)
      .where(and(eq(planSettings.clientId, clientId), eq(planSettings.scenarioId, scenario.id))),
    db.select().from(modelPortfolios).where(eq(modelPortfolios.firmId, firmId)),
    db.select().from(modelPortfolioAllocations),
    db.select().from(assetClasses).where(eq(assetClasses.firmId, firmId)),
    loadEffectiveTree(clientId, firmId, "base", {}),
  ]);

  const accountMetaById = new Map(accountMetaRows.map((r) => [r.id, r]));
  const liabilityMetaById = new Map(liabilityMetaRows.map((r) => [r.id, r]));
  const acMap = new Map(assetClassRows.map((ac) => [ac.id, ac]));

  const assetClassOptions = assetClassRows.map((ac) => ({
    id: ac.id,
    name: ac.name,
    slug: ac.slug,
    geometricReturn: parseFloat(ac.geometricReturn),
  }));

  const portfolioAllocationsMap: Record<string, { assetClassId: string; weight: number }[]> = {};
  for (const alloc of allocationRows) {
    const list = portfolioAllocationsMap[alloc.modelPortfolioId] ?? [];
    list.push({ assetClassId: alloc.assetClassId, weight: parseFloat(alloc.weight) });
    portfolioAllocationsMap[alloc.modelPortfolioId] = list;
  }

  const modelPortfolioOptions = portfolioRows.map((p) => {
    const allocs = allocationRows.filter((a) => a.modelPortfolioId === p.id);
    let blendedReturn = 0;
    for (const alloc of allocs) {
      const ac = acMap.get(alloc.assetClassId);
      if (ac) blendedReturn += parseFloat(alloc.weight) * parseFloat(ac.geometricReturn);
    }
    return { id: p.id, name: p.name, blendedReturn };
  });

  const settings = settingsRows[0];

  const firmInflationAc = assetClassRows.find((ac) => ac.slug === "inflation") ?? null;
  let clientInflationOverride: { geometricReturn: string } | null = null;
  if (settings?.useCustomCma && firmInflationAc) {
    const [override] = await db
      .select({ geometricReturn: clientCmaOverrides.geometricReturn })
      .from(clientCmaOverrides)
      .where(
        and(
          eq(clientCmaOverrides.clientId, clientId),
          eq(clientCmaOverrides.sourceAssetClassId, firmInflationAc.id),
        ),
      );
    if (override) clientInflationOverride = override;
  }
  const resolvedInflationRate = resolveInflationRate(
    {
      inflationRateSource: settings?.inflationRateSource ?? "custom",
      inflationRate: settings?.inflationRate ?? "0",
    },
    firmInflationAc ? { geometricReturn: firmInflationAc.geometricReturn } : null,
    clientInflationOverride,
  );

  const planStartYear = settings?.planStartYear ?? new Date().getFullYear();
  const planEndYear = settings?.planEndYear ?? new Date().getFullYear() + 30;
  const milestones = buildClientMilestones(client, planStartYear, planEndYear);

  const clientFmId = (effectiveTree.familyMembers ?? []).find((fm) => fm.role === "client")?.id ?? null;
  const spouseFmId = (effectiveTree.familyMembers ?? []).find((fm) => fm.role === "spouse")?.id ?? null;
  function ownerKeyOf(acct: (typeof effectiveTree.accounts)[number]): "client" | "spouse" | "joint" {
    const cfm = controllingFamilyMember(acct);
    if (cfm === spouseFmId && spouseFmId != null) return "spouse";
    if (cfm === clientFmId && clientFmId != null) return "client";
    return "joint";
  }

  const accountProps: AccountRow[] = effectiveTree.accounts.map((a) => {
    const meta = accountMetaById.get(a.id);
    return {
      id: a.id,
      name: a.name,
      category: a.category as AccountRow["category"],
      subType: a.subType,
      owner: ownerKeyOf(a),
      value: String(a.value),
      basis: String(a.basis),
      rothValue: a.rothValue != null ? String(a.rothValue) : null,
      growthRate: a.growthRate == null ? null : String(a.growthRate),
      rmdEnabled: a.rmdEnabled ?? null,
      priorYearEndValue: a.priorYearEndValue != null ? String(a.priorYearEndValue) : null,
      ownerEntityId: controllingEntity(a) ?? null,
      growthSource: meta?.growthSource ?? "default",
      modelPortfolioId: meta?.modelPortfolioId ?? null,
      turnoverPct: meta?.turnoverPct == null ? null : String(meta.turnoverPct),
      overridePctOi: meta?.overridePctOi == null ? null : String(meta.overridePctOi),
      overridePctLtCg: meta?.overridePctLtCg == null ? null : String(meta.overridePctLtCg),
      overridePctQdiv: meta?.overridePctQdiv == null ? null : String(meta.overridePctQdiv),
      overridePctTaxExempt:
        meta?.overridePctTaxExempt == null ? null : String(meta.overridePctTaxExempt),
      annualPropertyTax: meta?.annualPropertyTax == null ? null : String(meta.annualPropertyTax),
      propertyTaxGrowthRate:
        meta?.propertyTaxGrowthRate == null ? null : String(meta.propertyTaxGrowthRate),
      propertyTaxGrowthSource: meta?.propertyTaxGrowthSource ?? "custom",
      isDefaultChecking: a.isDefaultChecking ?? false,
      owners: a.owners,
    };
  });

  const liabilityProps: LiabilityRow[] = effectiveTree.liabilities.map((l) => {
    const meta = liabilityMetaById.get(l.id);
    return {
      id: l.id,
      name: l.name,
      balance: String(l.balance),
      interestRate: String(l.interestRate),
      monthlyPayment: String(l.monthlyPayment),
      startYear: l.startYear,
      startMonth: l.startMonth,
      termMonths: l.termMonths,
      termUnit: meta?.termUnit ?? "annual",
      balanceAsOfMonth: l.balanceAsOfMonth ?? null,
      balanceAsOfYear: l.balanceAsOfYear ?? null,
      linkedPropertyId: l.linkedPropertyId ?? null,
      ownerEntityId: controllingEntity(l) ?? null,
      isInterestDeductible: l.isInterestDeductible ?? false,
      owners: l.owners,
    };
  });

  const entityIds = entityRows.map((e) => e.id);
  const entityOwnerRows =
    entityIds.length > 0
      ? await db
          .select({
            entityId: entityOwners.entityId,
            familyMemberId: entityOwners.familyMemberId,
            percent: entityOwners.percent,
          })
          .from(entityOwners)
          .where(inArray(entityOwners.entityId, entityIds))
      : [];
  const ownersByEntity = new Map<string, { familyMemberId: string; percent: number }[]>();
  for (const row of entityOwnerRows) {
    const list = ownersByEntity.get(row.entityId) ?? [];
    list.push({ familyMemberId: row.familyMemberId, percent: parseFloat(row.percent) });
    ownersByEntity.set(row.entityId, list);
  }

  const entityOptions = entityRows.map((e) => ({
    id: e.id,
    name: e.name,
    entityType: e.entityType as string,
    value: String(e.value ?? "0"),
    owners: ownersByEntity.get(e.id),
  }));

  const categoryDefaultSources: Record<
    string,
    { source: string; portfolioId?: string; portfolioName?: string; blendedReturn?: number }
  > = {};
  if (settings) {
    const investable = [
      { category: "taxable", source: settings.growthSourceTaxable, portfolioId: settings.modelPortfolioIdTaxable },
      { category: "cash", source: settings.growthSourceCash, portfolioId: settings.modelPortfolioIdCash },
      { category: "retirement", source: settings.growthSourceRetirement, portfolioId: settings.modelPortfolioIdRetirement },
    ];
    for (const entry of investable) {
      if (entry.source === "inflation") {
        categoryDefaultSources[entry.category] = {
          source: entry.source,
          portfolioName: "Inflation",
          blendedReturn: resolvedInflationRate,
        };
        continue;
      }
      if (entry.source === "model_portfolio" && entry.portfolioId) {
        const mp = modelPortfolioOptions.find((p) => p.id === entry.portfolioId);
        categoryDefaultSources[entry.category] = {
          source: entry.source,
          portfolioId: entry.portfolioId,
          portfolioName: mp?.name,
          blendedReturn: mp?.blendedReturn,
        };
        continue;
      }
      categoryDefaultSources[entry.category] = { source: entry.source };
    }
  }

  const flatRate = (rawRate: string, source: string | undefined): string =>
    source === "inflation" ? String(resolvedInflationRate) : String(rawRate);

  const investableEffectiveRate = (
    source: string | undefined,
    portfolioId: string | null | undefined,
    customRate: string,
  ): string => {
    if (source === "inflation") return String(resolvedInflationRate);
    if (source === "model_portfolio" && portfolioId) {
      const mp = modelPortfolioOptions.find((p) => p.id === portfolioId);
      if (mp) return String(mp.blendedReturn);
    }
    return String(customRate);
  };

  const categoryDefaults = settings
    ? {
        taxable: investableEffectiveRate(settings.growthSourceTaxable, settings.modelPortfolioIdTaxable, settings.defaultGrowthTaxable),
        cash: investableEffectiveRate(settings.growthSourceCash, settings.modelPortfolioIdCash, settings.defaultGrowthCash),
        retirement: investableEffectiveRate(settings.growthSourceRetirement, settings.modelPortfolioIdRetirement, settings.defaultGrowthRetirement),
        real_estate: flatRate(settings.defaultGrowthRealEstate, settings.growthSourceRealEstate),
        business: flatRate(settings.defaultGrowthBusiness, settings.growthSourceBusiness),
        life_insurance: flatRate(settings.defaultGrowthLifeInsurance, settings.growthSourceLifeInsurance),
      }
    : {
        taxable: "0.07",
        cash: "0.02",
        retirement: "0.07",
        real_estate: "0.04",
        business: "0.05",
        life_insurance: "0.03",
      };

  const ownerNames = {
    clientName: `${client.firstName} ${client.lastName}`,
    spouseName: client.spouseName
      ? `${client.spouseName} ${client.spouseLastName ?? client.lastName}`.trim()
      : null,
  };

  return {
    accountProps,
    liabilityProps,
    entityOptions,
    familyMemberRows,
    categoryDefaults,
    modelPortfolioOptions,
    ownerNames,
    assetClassOptions,
    portfolioAllocationsMap,
    categoryDefaultSources,
    milestones,
    resolvedInflationRate,
  };
}

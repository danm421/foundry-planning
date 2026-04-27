import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  clients,
  scenarios,
  accounts,
  liabilities,
  entities,
  familyMembers,
  planSettings,
  modelPortfolios,
  modelPortfolioAllocations,
  assetClasses,
  clientCmaOverrides,
} from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import BalanceSheetView, { AccountRow, LiabilityRow } from "@/components/balance-sheet-view";
import { buildClientMilestones } from "@/lib/milestones";
import { resolveInflationRate } from "@/lib/inflation";
import ClientDataPageShell from "@/components/client-data-page-shell";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { controllingEntity, controllingFamilyMember } from "@/engine/ownership";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scenario?: string }>;
}

export default async function BalanceSheetPage({ params, searchParams }: PageProps) {
  const firmId = await getOrgId();
  const { id } = await params;
  const sp = await searchParams;

  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

  if (!client) notFound();

  const [scenario] = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.clientId, id), eq(scenarios.isBaseCase, true)));

  if (!scenario) {
    return (
      <ClientDataPageShell clientId={id} scenarioId={sp.scenario}>
        <div className="rounded-lg border border-gray-700 bg-gray-900 p-6 text-center text-gray-300">
          No base case scenario found.
        </div>
      </ClientDataPageShell>
    );
  }

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
      })
      .from(accounts)
      .where(and(eq(accounts.clientId, id), eq(accounts.scenarioId, scenario.id))),
    db
      .select({
        id: liabilities.id,
        termUnit: liabilities.termUnit,
      })
      .from(liabilities)
      .where(and(eq(liabilities.clientId, id), eq(liabilities.scenarioId, scenario.id))),
    db.select().from(entities).where(eq(entities.clientId, id)).orderBy(asc(entities.name)),
    db
      .select({ id: familyMembers.id, role: familyMembers.role, firstName: familyMembers.firstName })
      .from(familyMembers)
      .where(eq(familyMembers.clientId, id))
      .orderBy(asc(familyMembers.role), asc(familyMembers.firstName)),
    db
      .select()
      .from(planSettings)
      .where(and(eq(planSettings.clientId, id), eq(planSettings.scenarioId, scenario.id))),
    db.select().from(modelPortfolios).where(eq(modelPortfolios.firmId, firmId)),
    db.select().from(modelPortfolioAllocations),
    db.select().from(assetClasses).where(eq(assetClasses.firmId, firmId)),
    loadEffectiveTree(id, firmId, sp.scenario ?? "base", {}),
  ]);

  const accountMetaById = new Map(accountMetaRows.map((r) => [r.id, r]));
  const liabilityMetaById = new Map(liabilityMetaRows.map((r) => [r.id, r]));

  // Compute blended returns for each model portfolio
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

  // Resolve inflation rate for the account growth-source dropdown
  const firmInflationAc = assetClassRows.find((ac) => ac.slug === "inflation") ?? null;
  let clientInflationOverride: { geometricReturn: string } | null = null;
  if (settings?.useCustomCma && firmInflationAc) {
    const [override] = await db
      .select({ geometricReturn: clientCmaOverrides.geometricReturn })
      .from(clientCmaOverrides)
      .where(and(
        eq(clientCmaOverrides.clientId, id),
        eq(clientCmaOverrides.sourceAssetClassId, firmInflationAc.id),
      ));
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

  // Build milestones for MilestoneYearPicker in the savings sub-form
  const planStartYear = settings?.planStartYear ?? new Date().getFullYear();
  const planEndYear = settings?.planEndYear ?? new Date().getFullYear() + 30;
  const milestones = buildClientMilestones(client, planStartYear, planEndYear);

  // Derive owner key for UI display from owners[].
  const _clientFmId = (effectiveTree.familyMembers ?? []).find((fm) => fm.role === "client")?.id ?? null;
  const _spouseFmId = (effectiveTree.familyMembers ?? []).find((fm) => fm.role === "spouse")?.id ?? null;
  function _ownerKeyOf(acct: (typeof effectiveTree.accounts)[number]): string {
    const cfm = controllingFamilyMember(acct);
    if (cfm === _spouseFmId && _spouseFmId != null) return "spouse";
    if (cfm === _clientFmId && _clientFmId != null) return "client";
    return "joint";
  }

  const accountProps: AccountRow[] = effectiveTree.accounts.map((a) => {
    const meta = accountMetaById.get(a.id);
    return {
      id: a.id,
      name: a.name,
      category: a.category as AccountRow["category"],
      subType: a.subType,
      owner: _ownerKeyOf(a),
      value: String(a.value),
      basis: String(a.basis),
      growthRate: a.growthRate == null ? null : String(a.growthRate),
      rmdEnabled: a.rmdEnabled ?? null,
      ownerEntityId: controllingEntity(a) ?? null,
      growthSource: meta?.growthSource ?? "default",
      modelPortfolioId: meta?.modelPortfolioId ?? null,
      turnoverPct: meta?.turnoverPct == null ? null : String(meta.turnoverPct),
      overridePctOi: meta?.overridePctOi == null ? null : String(meta.overridePctOi),
      overridePctLtCg: meta?.overridePctLtCg == null ? null : String(meta.overridePctLtCg),
      overridePctQdiv: meta?.overridePctQdiv == null ? null : String(meta.overridePctQdiv),
      overridePctTaxExempt:
        meta?.overridePctTaxExempt == null ? null : String(meta.overridePctTaxExempt),
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

  const entityOptions = entityRows.map((e) => ({
    id: e.id,
    name: e.name,
    entityType: e.entityType as string,
    value: String(e.value ?? "0"),
  }));

  // Build category default source info so the account form knows which portfolio
  // backs the "Use category default" option for investable categories
  const categoryDefaultSources: Record<string, { source: string; portfolioId?: string; portfolioName?: string; blendedReturn?: number }> = {};
  if (settings) {
    const investable = [
      { category: "taxable", source: settings.growthSourceTaxable, portfolioId: settings.modelPortfolioIdTaxable },
      { category: "cash", source: settings.growthSourceCash, portfolioId: settings.modelPortfolioIdCash },
      { category: "retirement", source: settings.growthSourceRetirement, portfolioId: settings.modelPortfolioIdRetirement },
    ];
    for (const entry of investable) {
      const mp = entry.portfolioId ? modelPortfolioOptions.find((p) => p.id === entry.portfolioId) : undefined;
      categoryDefaultSources[entry.category] = {
        source: entry.source,
        portfolioId: entry.portfolioId ?? undefined,
        portfolioName: mp?.name,
        blendedReturn: mp?.blendedReturn,
      };
    }
  }

  const categoryDefaults = settings
    ? {
        taxable: String(settings.defaultGrowthTaxable),
        cash: String(settings.defaultGrowthCash),
        retirement: String(settings.defaultGrowthRetirement),
        real_estate: String(settings.defaultGrowthRealEstate),
        business: String(settings.defaultGrowthBusiness),
        life_insurance: String(settings.defaultGrowthLifeInsurance),
      }
    : {
        taxable: "0.07",
        cash: "0.02",
        retirement: "0.07",
        real_estate: "0.04",
        business: "0.05",
        life_insurance: "0.03",
      };

  return (
    <ClientDataPageShell clientId={id} scenarioId={sp.scenario}>
      <BalanceSheetView
        clientId={id}
        accounts={accountProps}
        liabilities={liabilityProps}
        entities={entityOptions}
        familyMembers={familyMemberRows}
        categoryDefaults={categoryDefaults}
        modelPortfolios={modelPortfolioOptions}
        ownerNames={{
          clientName: `${client.firstName} ${client.lastName}`,
          spouseName: client.spouseName
            ? `${client.spouseName} ${client.spouseLastName ?? client.lastName}`.trim()
            : null,
        }}
        assetClasses={assetClassOptions}
        portfolioAllocationsMap={portfolioAllocationsMap}
        categoryDefaultSources={categoryDefaultSources}
        milestones={milestones}
        resolvedInflationRate={resolvedInflationRate}
      />
    </ClientDataPageShell>
  );
}

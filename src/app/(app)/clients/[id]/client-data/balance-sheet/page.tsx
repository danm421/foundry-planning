import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  clients,
  scenarios,
  accounts,
  liabilities,
  entities,
  planSettings,
  modelPortfolios,
  modelPortfolioAllocations,
  assetClasses,
} from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import BalanceSheetView, { AccountRow, LiabilityRow } from "@/components/balance-sheet-view";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function BalanceSheetPage({ params }: PageProps) {
  const firmId = await getOrgId();
  const { id } = await params;

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
      <div className="rounded-lg border border-gray-700 bg-gray-900 p-6 text-center text-gray-400">
        No base case scenario found.
      </div>
    );
  }

  const [accountRows, liabilityRows, entityRows, settingsRows, portfolioRows, allocationRows, assetClassRows] = await Promise.all([
    db
      .select()
      .from(accounts)
      .where(and(eq(accounts.clientId, id), eq(accounts.scenarioId, scenario.id))),
    db
      .select()
      .from(liabilities)
      .where(and(eq(liabilities.clientId, id), eq(liabilities.scenarioId, scenario.id))),
    db.select().from(entities).where(eq(entities.clientId, id)).orderBy(asc(entities.name)),
    db
      .select()
      .from(planSettings)
      .where(and(eq(planSettings.clientId, id), eq(planSettings.scenarioId, scenario.id))),
    db.select().from(modelPortfolios).where(eq(modelPortfolios.firmId, firmId)),
    db.select().from(modelPortfolioAllocations),
    db.select().from(assetClasses).where(eq(assetClasses.firmId, firmId)),
  ]);

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

  const accountProps: AccountRow[] = accountRows.map((a) => ({
    id: a.id,
    name: a.name,
    category: a.category as AccountRow["category"],
    subType: a.subType,
    owner: a.owner,
    value: String(a.value),
    basis: String(a.basis),
    growthRate: a.growthRate == null ? null : String(a.growthRate),
    rmdEnabled: a.rmdEnabled ?? null,
    ownerEntityId: a.ownerEntityId ?? null,
    growthSource: a.growthSource ?? "default",
    modelPortfolioId: a.modelPortfolioId ?? null,
    turnoverPct: a.turnoverPct == null ? null : String(a.turnoverPct),
    overridePctOi: a.overridePctOi == null ? null : String(a.overridePctOi),
    overridePctLtCg: a.overridePctLtCg == null ? null : String(a.overridePctLtCg),
    overridePctQdiv: a.overridePctQdiv == null ? null : String(a.overridePctQdiv),
    overridePctTaxExempt: a.overridePctTaxExempt == null ? null : String(a.overridePctTaxExempt),
  }));

  const liabilityProps: LiabilityRow[] = liabilityRows.map((l) => ({
    id: l.id,
    name: l.name,
    balance: String(l.balance),
    interestRate: String(l.interestRate),
    monthlyPayment: String(l.monthlyPayment),
    startYear: l.startYear,
    startMonth: l.startMonth,
    termMonths: l.termMonths,
    termUnit: l.termUnit,
    balanceAsOfMonth: l.balanceAsOfMonth ?? null,
    balanceAsOfYear: l.balanceAsOfYear ?? null,
    linkedPropertyId: l.linkedPropertyId ?? null,
    ownerEntityId: l.ownerEntityId ?? null,
    isInterestDeductible: l.isInterestDeductible,
  }));

  const entityOptions = entityRows.map((e) => ({ id: e.id, name: e.name }));

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
    <BalanceSheetView
      clientId={id}
      accounts={accountProps}
      liabilities={liabilityProps}
      entities={entityOptions}
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
    />
  );
}

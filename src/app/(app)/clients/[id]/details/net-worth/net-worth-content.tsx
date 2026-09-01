import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  clients,
  crmHouseholdContacts,
  scenarios,
  liabilities,
  entities,
  entityOwners,
  familyMembers,
  planSettings,
  modelPortfolios,
  modelPortfolioAllocations,
  assetClasses,
  clientCmaOverrides,
} from "@/db/schema";
import { eq, and, asc, inArray } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import BalanceSheetView, { AccountRow, LiabilityRow } from "@/components/balance-sheet-view";
import { buildClientMilestones } from "@/lib/milestones";
import { resolveInflationRate } from "@/lib/inflation";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { loadOverlaidAccountMeta } from "@/lib/scenario/account-meta";
import { loadNotesReceivable } from "@/lib/loaders/notes-receivable";
import { loadFundPortfolioOptions } from "@/lib/investments/load-fund-portfolio-options";
import type { GrowthContext } from "@/lib/investments/growth-context";
import { controllingEntity } from "@/engine/ownership";
import { buildAccountRows, loadAccountMetaRows, linkedSourceMapFrom } from "@/lib/accounts/load-account-rows";
import { categoryDefaultRates } from "@/lib/investments/category-default-rates";
import { buildIncomeRows } from "@/lib/balance-sheet/build-income-rows";

interface NetWorthContentProps {
  clientId: string;
  scenarioParam: string | undefined;
}

export async function NetWorthContent({ clientId: id, scenarioParam }: NetWorthContentProps) {
  const firmId = await getOrgId();

  const [clientRow] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

  if (!clientRow) notFound();

  // CRM contacts — sole source of identity (firstName, lastName, DOB) for
  // milestone math + spouseLastName display fallback.
  const contactRows = await db
    .select()
    .from(crmHouseholdContacts)
    .where(eq(crmHouseholdContacts.householdId, clientRow.crmHouseholdId));
  const primaryContact = contactRows.find((c) => c.role === "primary");
  const spouseContact = contactRows.find((c) => c.role === "spouse");
  if (!primaryContact?.dateOfBirth) notFound();
  const client = {
    ...clientRow,
    dateOfBirth: primaryContact.dateOfBirth,
    spouseDob: spouseContact?.dateOfBirth ?? null,
    spouseLastName: spouseContact?.lastName ?? null,
  };

  const [scenario] = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.clientId, id), eq(scenarios.isBaseCase, true)));

  if (!scenario) {
    return (
      <div className="rounded-lg border border-hair bg-card p-6 text-center text-ink-2">
        No base case scenario found.
      </div>
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
    notesReceivableRows,
    fundPortfolioOptions,
  ] = await Promise.all([
    loadAccountMetaRows(id, scenario.id),
    db
      .select({
        id: liabilities.id,
        termUnit: liabilities.termUnit,
        plaidItemId: liabilities.plaidItemId,
      })
      .from(liabilities)
      .where(and(eq(liabilities.clientId, id), eq(liabilities.scenarioId, scenario.id))),
    db.select().from(entities).where(eq(entities.clientId, id)).orderBy(asc(entities.name)),
    db
      .select({
        id: familyMembers.id,
        role: familyMembers.role,
        firstName: familyMembers.firstName,
        lastName: familyMembers.lastName,
      })
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
    loadEffectiveTree(id, firmId, scenarioParam ?? "base", {}),
    loadNotesReceivable(id, scenario.id),
    loadFundPortfolioOptions(firmId),
  ]);

  // F11: the meta query above is scoped to the base-case scenario; overlay the
  // scenario's account add/edit changes so scenario-edited accounts show their
  // edited metadata and scenario-added accounts don't fall to defaults.
  const accountMetaById = await loadOverlaidAccountMeta(id, accountMetaRows, scenarioParam);
  const liabilityMetaById = new Map(liabilityMetaRows.map((r) => [r.id, r]));

  // Linked-account indicator: an account fed by an external integration shows a
  // small badge next to its name in the Net Worth view. `plaidItemId` is the
  // reliable Plaid signal (the `source` enum can lag until holdings ingest);
  // `externalProvider === "orion"` drives the Orion label. Base-scoped like the
  // metadata above, so scenario-added accounts (no entry) correctly read as
  // manual with no badge.
  const linkedSourceById = linkedSourceMapFrom(accountMetaRows);

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
    // `riskLevel` is carried for the inline growth cell's `GrowthContext`
    // (`GrowthContextPortfolio` requires it). It is a real column
    // (`model_portfolios.risk_level`, nullable), not a placeholder. The
    // `modelPortfolios` prop below takes the narrower `ModelPortfolioOption`
    // and simply ignores the extra field.
    return { id: p.id, name: p.name, blendedReturn, riskLevel: p.riskLevel };
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

  const accountProps: AccountRow[] = buildAccountRows({
    accounts: effectiveTree.accounts,
    familyMembers: effectiveTree.familyMembers ?? [],
    accountMetaById,
    linkedSourceById,
    stockOptionPlans: effectiveTree.stockOptionPlans,
    planStartYear,
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
      linkedSource: meta?.plaidItemId != null ? "plaid" : null,
      owners: l.owners,
      parentAccountId: l.parentAccountId ?? null,
    };
  });

  const entityIds = entityRows.map((e) => e.id);
  const entityOwnerRows = entityIds.length > 0
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
    // entity_owners now also models entity-owned-by-entity rows (ownerEntityId);
    // this view only attributes value to family-member owners.
    if (!row.familyMemberId) continue;
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

  // Build category default source info
  const categoryDefaultSources: Record<string, { source: string; portfolioId?: string; portfolioName?: string; blendedReturn?: number }> = {};
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

  const categoryDefaults = categoryDefaultRates(
    settings,
    modelPortfolioOptions,
    resolvedInflationRate,
  );

  // Growth-rate dropdown context for the inline rate cell on asset rows. Built
  // on the server and passed down, mirroring `map-content.tsx` — the client
  // view cannot derive it from the props it already gets, which carry neither
  // `riskLevel` nor the percent-scaled category labels.
  const growthContext: GrowthContext = {
    modelPortfolios: modelPortfolioOptions,
    fundPortfolios: fundPortfolioOptions,
    resolvedInflationRate,
    categoryDefaults: Object.fromEntries(
      Object.entries(categoryDefaultSources).map(([category, s]) => [
        category,
        {
          portfolioName: s.portfolioName ?? null,
          // UNITS: `blendedReturn` here is a DECIMAL (0.06);
          // `blendedReturnPct` is a PERCENT (6). Dropping the ×100 renders
          // "0.06% — Model portfolio".
          blendedReturnPct: s.blendedReturn != null ? s.blendedReturn * 100 : null,
        },
      ]),
    ),
  };

  return (
    <BalanceSheetView
      clientId={id}
      accounts={accountProps}
      liabilities={liabilityProps}
      notesReceivable={notesReceivableRows}
      incomes={buildIncomeRows(effectiveTree.incomes)}
      expenses={effectiveTree.expenses.map((e) => ({
        id: e.id,
        name: e.name,
        annualAmount: e.annualAmount,
        ownerAccountId: e.ownerAccountId ?? null,
        startYear: e.startYear,
        endYear: e.endYear,
        growthRate: e.growthRate,
        inflationStartYear: e.inflationStartYear ?? null,
      }))}
      planStartYear={planStartYear}
      planEndYear={planEndYear}
      primaryClientBirthYear={parseInt(primaryContact.dateOfBirth.slice(0, 4), 10)}
      entities={entityOptions}
      familyMembers={familyMemberRows}
      categoryDefaults={categoryDefaults}
      modelPortfolios={modelPortfolioOptions}
      fundPortfolios={fundPortfolioOptions}
      ownerNames={{
        clientName: `${effectiveTree.client.firstName} ${effectiveTree.client.lastName}`,
        spouseName: effectiveTree.client.spouseName
          ? `${effectiveTree.client.spouseName} ${client.spouseLastName ?? effectiveTree.client.lastName}`.trim()
          : null,
      }}
      assetClasses={assetClassOptions}
      portfolioAllocationsMap={portfolioAllocationsMap}
      categoryDefaultSources={categoryDefaultSources}
      milestones={milestones}
      resolvedInflationRate={resolvedInflationRate}
      growthContext={growthContext}
      categoryDefaultRates={categoryDefaults}
    />
  );
}

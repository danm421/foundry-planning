import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  clients,
  scenarios,
  planSettings,
  withdrawalStrategies,
  modelPortfolios,
  modelPortfolioAllocations,
  assetClasses,
  clientCmaOverrides,
  clientDeductions,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import AssumptionsClient from "./assumptions-client";
import { buildClientMilestones, resolveMilestone, type YearRef } from "@/lib/milestones";
import { resolveInflationRate } from "@/lib/inflation";
import { amortizeLiability } from "@/engine/liabilities";
import ClientDataPageShell from "@/components/client-data-page-shell";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { controllingEntity, controllingFamilyMember } from "@/engine/ownership";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scenario?: string }>;
}

export default async function AssumptionsPage({ params, searchParams }: PageProps) {
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
    settingsRows,
    withdrawalRows,
    portfolioRows,
    allocationRows,
    assetClassRows,
    deductionRows,
    { effectiveTree },
  ] = await Promise.all([
    db
      .select()
      .from(planSettings)
      .where(and(eq(planSettings.clientId, id), eq(planSettings.scenarioId, scenario.id))),
    db
      .select()
      .from(withdrawalStrategies)
      .where(
        and(
          eq(withdrawalStrategies.clientId, id),
          eq(withdrawalStrategies.scenarioId, scenario.id)
        )
      ),
    db.select().from(modelPortfolios).where(eq(modelPortfolios.firmId, firmId)),
    db.select().from(modelPortfolioAllocations),
    db.select().from(assetClasses).where(eq(assetClasses.firmId, firmId)),
    db
      .select()
      .from(clientDeductions)
      .where(and(eq(clientDeductions.clientId, id), eq(clientDeductions.scenarioId, scenario.id))),
    loadEffectiveTree(id, firmId, sp.scenario ?? "base", {}),
  ]);

  const accountRows = effectiveTree.accounts;
  const savingsRows = effectiveTree.savingsRules;
  const expenseRows = effectiveTree.expenses;
  const liabilityRows = effectiveTree.liabilities;

  // Derive per-account owner key ("client" | "spouse" | "joint") for UI display.
  const _clientFmId = (effectiveTree.familyMembers ?? []).find((fm) => fm.role === "client")?.id ?? null;
  const _spouseFmId = (effectiveTree.familyMembers ?? []).find((fm) => fm.role === "spouse")?.id ?? null;
  function _ownerKeyOf(acct: (typeof accountRows)[number]): "client" | "spouse" | "joint" {
    const cfm = controllingFamilyMember(acct);
    if (cfm === _spouseFmId && _spouseFmId != null) return "spouse";
    if (cfm === _clientFmId && _clientFmId != null) return "client";
    return "joint";
  }

  const settings = settingsRows[0];
  if (!settings) {
    return (
      <ClientDataPageShell clientId={id} scenarioId={sp.scenario}>
        <div className="rounded-lg border border-gray-700 bg-gray-900 p-6 text-center text-gray-300">
          No plan settings found.
        </div>
      </ClientDataPageShell>
    );
  }

  const [firmInflationAc] = await db
    .select({ id: assetClasses.id, geometricReturn: assetClasses.geometricReturn })
    .from(assetClasses)
    .where(and(eq(assetClasses.firmId, firmId), eq(assetClasses.slug, "inflation")));

  let clientInflationOverride: { geometricReturn: string } | null = null;
  if (settings.useCustomCma && firmInflationAc) {
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
    { inflationRateSource: settings.inflationRateSource, inflationRate: settings.inflationRate },
    firmInflationAc ?? null,
    clientInflationOverride,
  );

  // Compute blended returns for each model portfolio
  const acMap = new Map(assetClassRows.map((ac) => [ac.id, ac]));
  const modelPortfolioOptions = portfolioRows.map((p) => {
    const allocs = allocationRows.filter((a) => a.modelPortfolioId === p.id);
    let blendedReturn = 0;
    for (const alloc of allocs) {
      const ac = acMap.get(alloc.assetClassId);
      if (ac) blendedReturn += parseFloat(alloc.weight) * parseFloat(ac.geometricReturn);
    }
    return { id: p.id, name: p.name, blendedReturn };
  });

  const milestones = buildClientMilestones(client, settings.planStartYear, settings.planEndYear);

  // Resolution-on-read: re-resolve milestone refs and update stale years
  for (const row of withdrawalRows) {
    if (row.startYearRef) {
      const resolved = resolveMilestone(row.startYearRef as YearRef, milestones, "start");
      if (resolved != null && resolved !== row.startYear) {
        row.startYear = resolved;
        db.update(withdrawalStrategies).set({ startYear: resolved }).where(eq(withdrawalStrategies.id, row.id));
      }
    }
    if (row.endYearRef) {
      const resolved = resolveMilestone(row.endYearRef as YearRef, milestones, "end");
      if (resolved != null && resolved !== row.endYear) {
        row.endYear = resolved;
        db.update(withdrawalStrategies).set({ endYear: resolved }).where(eq(withdrawalStrategies.id, row.id));
      }
    }
  }

  // ── Deductions-tab derived data ─────────────────────────────────────────
  // Mirrors what the old deductions/page.tsx server page used to compute so
  // the Deductions sub-tab renders the same summary + itemized list it
  // always has.
  const currentYear = new Date().getFullYear();
  const saltCap = currentYear >= 2026 ? 40_000 : 10_000;

  const derivedRows = savingsRows
    .filter((r) => {
      const acct = accountRows.find((a) => a.id === r.accountId);
      if (!acct) return false;
      if (acct.subType !== "traditional_ira" && acct.subType !== "401k") return false;
      if (currentYear < r.startYear || currentYear > r.endYear) return false;
      return true;
    })
    .map((r) => {
      const acct = accountRows.find((a) => a.id === r.accountId)!;
      return {
        id: r.id,
        accountName: acct.name,
        subType: acct.subType ?? "",
        annualAmount: r.annualAmount,
        owner: _ownerKeyOf(acct),
        startYear: r.startYear,
        endYear: r.endYear,
      };
    });

  const expenseDeductionRows = expenseRows
    .filter((e) => e.deductionType != null)
    .map((e) => ({
      id: e.id,
      name: e.name,
      deductionType: e.deductionType!,
      annualAmount: e.annualAmount,
    }));

  const mortgageRows = liabilityRows
    .filter((l) => l.isInterestDeductible)
    .map((l) => {
      const result = amortizeLiability(l, currentYear);
      return {
        id: l.id,
        name: l.name,
        estimatedInterest: result.interestPortion,
      };
    })
    .filter((r) => r.estimatedInterest > 0);

  const propertyTaxRows = accountRows
    .filter((a) => (a.annualPropertyTax ?? 0) > 0)
    .map((a) => {
      const baseTax = a.annualPropertyTax ?? 0;
      const growthRate = a.propertyTaxGrowthRate ?? 0;
      const currentYearInflated = baseTax * Math.pow(1 + growthRate, 0);
      return {
        id: a.id,
        name: a.name,
        annualPropertyTax: baseTax,
        currentYearInflated,
      };
    });

  const itemizedRows = deductionRows.map((d) => ({
    id: d.id,
    type: d.type,
    name: d.name,
    owner: d.owner,
    annualAmount: parseFloat(d.annualAmount),
    growthRate: parseFloat(d.growthRate),
    startYear: d.startYear,
    endYear: d.endYear,
    startYearRef: d.startYearRef,
    endYearRef: d.endYearRef,
  }));

  return (
    <ClientDataPageShell clientId={id} scenarioId={sp.scenario}>
      <div className="max-w-3xl space-y-6">
        <div>
          <h2 className="text-xl font-bold text-gray-100">Assumptions</h2>
          <p className="mt-1 text-sm text-gray-300">
            Plan horizon, tax rates, growth assumptions, and withdrawal order.
          </p>
        </div>

        <AssumptionsClient
        clientId={id}
        settings={{
          flatFederalRate: String(settings.flatFederalRate),
          flatStateRate: String(settings.flatStateRate),
          estateAdminExpenses: String(settings.estateAdminExpenses),
          flatStateEstateRate: String(settings.flatStateEstateRate),
          residenceState: (settings.residenceState ?? null) as import("@/lib/tax/state-estate").StateCode | null,
          irdTaxRate: String(settings.irdTaxRate),
          inflationRate: String(settings.inflationRate),
          inflationRateSource: settings.inflationRateSource,
          planStartYear: settings.planStartYear,
          planEndYear: settings.planEndYear,
          defaultGrowthTaxable: String(settings.defaultGrowthTaxable),
          defaultGrowthCash: String(settings.defaultGrowthCash),
          defaultGrowthRetirement: String(settings.defaultGrowthRetirement),
          defaultGrowthRealEstate: String(settings.defaultGrowthRealEstate),
          defaultGrowthBusiness: String(settings.defaultGrowthBusiness),
          defaultGrowthLifeInsurance: String(settings.defaultGrowthLifeInsurance),
          growthSourceTaxable: settings.growthSourceTaxable,
          growthSourceCash: settings.growthSourceCash,
          growthSourceRetirement: settings.growthSourceRetirement,
          growthSourceRealEstate: settings.growthSourceRealEstate,
          growthSourceBusiness: settings.growthSourceBusiness,
          growthSourceLifeInsurance: settings.growthSourceLifeInsurance,
          modelPortfolioIdTaxable: settings.modelPortfolioIdTaxable,
          modelPortfolioIdCash: settings.modelPortfolioIdCash,
          modelPortfolioIdRetirement: settings.modelPortfolioIdRetirement,
          taxEngineMode: settings.taxEngineMode,
          taxInflationRate: settings.taxInflationRate != null ? String(settings.taxInflationRate) : "",
          ssWageGrowthRate: settings.ssWageGrowthRate != null ? String(settings.ssWageGrowthRate) : "",
          outOfHouseholdDniRate: String(settings.outOfHouseholdDniRate),
          priorTaxableGiftsClient: String(settings.priorTaxableGiftsClient),
          priorTaxableGiftsSpouse: String(settings.priorTaxableGiftsSpouse),
        }}
        resolvedInflationRate={resolvedInflationRate}
        hasInflationAssetClass={firmInflationAc != null}
        modelPortfolios={modelPortfolioOptions}
        accounts={accountRows.map((a) => ({
          id: a.id,
          name: a.name,
          category: a.category,
          subType: a.subType,
          isDefaultChecking: a.isDefaultChecking,
          ownerEntityId: controllingEntity(a) ?? null,
        }))}
        withdrawalStrategies={withdrawalRows}
        milestones={milestones}
        clientFirstName={client.firstName}
        spouseFirstName={client.spouseName?.split(" ")[0]}
        deductionsData={{
          derivedRows,
          expenseDeductionRows,
          mortgageRows,
          propertyTaxRows,
          itemizedRows,
          currentYear,
          saltCap,
        }}
      />
      </div>
    </ClientDataPageShell>
  );
}

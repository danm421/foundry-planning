import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  clients,
  scenarios,
  planSettings,
  accounts,
  withdrawalStrategies,
  modelPortfolios,
  modelPortfolioAllocations,
  assetClasses,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import AssumptionsClient from "./assumptions-client";
import { buildClientMilestones, resolveMilestone, type YearRef } from "@/lib/milestones";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AssumptionsPage({ params }: PageProps) {
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

  const [settingsRows, accountRows, withdrawalRows, portfolioRows, allocationRows, assetClassRows] = await Promise.all([
    db
      .select()
      .from(planSettings)
      .where(and(eq(planSettings.clientId, id), eq(planSettings.scenarioId, scenario.id))),
    db
      .select()
      .from(accounts)
      .where(and(eq(accounts.clientId, id), eq(accounts.scenarioId, scenario.id))),
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
  ]);

  const settings = settingsRows[0];
  if (!settings) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-900 p-6 text-center text-gray-400">
        No plan settings found.
      </div>
    );
  }

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
      const resolved = resolveMilestone(row.startYearRef as YearRef, milestones);
      if (resolved != null && resolved !== row.startYear) {
        row.startYear = resolved;
        db.update(withdrawalStrategies).set({ startYear: resolved }).where(eq(withdrawalStrategies.id, row.id));
      }
    }
    if (row.endYearRef) {
      const resolved = resolveMilestone(row.endYearRef as YearRef, milestones);
      if (resolved != null && resolved !== row.endYear) {
        row.endYear = resolved;
        db.update(withdrawalStrategies).set({ endYear: resolved }).where(eq(withdrawalStrategies.id, row.id));
      }
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-100">Assumptions</h2>
        <p className="mt-1 text-sm text-gray-400">
          Plan horizon, tax rates, growth assumptions, and withdrawal order.
        </p>
      </div>

      <AssumptionsClient
        clientId={id}
        settings={{
          flatFederalRate: String(settings.flatFederalRate),
          flatStateRate: String(settings.flatStateRate),
          inflationRate: String(settings.inflationRate),
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
          modelPortfolioIdTaxable: settings.modelPortfolioIdTaxable,
          modelPortfolioIdCash: settings.modelPortfolioIdCash,
          modelPortfolioIdRetirement: settings.modelPortfolioIdRetirement,
          taxEngineMode: settings.taxEngineMode,
          taxInflationRate: settings.taxInflationRate != null ? String(settings.taxInflationRate) : "",
          ssWageGrowthRate: settings.ssWageGrowthRate != null ? String(settings.ssWageGrowthRate) : "",
        }}
        modelPortfolios={modelPortfolioOptions}
        accounts={accountRows.map((a) => ({
          id: a.id,
          name: a.name,
          category: a.category,
          subType: a.subType,
          isDefaultChecking: a.isDefaultChecking,
          ownerEntityId: a.ownerEntityId,
        }))}
        withdrawalStrategies={withdrawalRows}
        milestones={milestones}
      />
    </div>
  );
}

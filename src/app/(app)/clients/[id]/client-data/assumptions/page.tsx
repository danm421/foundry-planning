import { notFound } from "next/navigation";
import { db } from "@/db";
import { clients, scenarios, planSettings } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import AssumptionsForm, { AssumptionsInitial } from "@/components/forms/assumptions-form";

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

  const [settings] = await db
    .select()
    .from(planSettings)
    .where(and(eq(planSettings.clientId, id), eq(planSettings.scenarioId, scenario.id)));

  if (!settings) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-900 p-6 text-center text-gray-400">
        No plan settings found.
      </div>
    );
  }

  const initial: AssumptionsInitial = {
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
  };

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-100">Assumptions</h2>
        <p className="mt-1 text-sm text-gray-400">
          Tax rates, inflation, plan horizon, and default growth rates applied across this client&apos;s plan.
        </p>
      </div>
      <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-6">
        <AssumptionsForm clientId={id} initial={initial} />
      </div>
    </div>
  );
}

import { notFound } from "next/navigation";
import { db } from "@/db";
import { clients, scenarios, planSettings } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import PlanSettingsForm from "@/components/forms/plan-settings-form";

interface SettingsPageProps {
  params: Promise<{ id: string }>;
}

export default async function SettingsPage({ params }: SettingsPageProps) {
  const firmId = await getOrgId();
  const { id } = await params;

  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

  if (!client) {
    notFound();
  }

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

  return (
    <div className="max-w-2xl">
      <div className="overflow-hidden rounded-lg border border-gray-700 bg-gray-900 shadow-sm">
        <div className="border-b border-gray-700 bg-gray-800 px-6 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400">Plan Settings</h2>
        </div>
        <div className="p-6">
          <PlanSettingsForm
            clientId={id}
            initialSettings={{
              flatFederalRate: settings.flatFederalRate,
              flatStateRate: settings.flatStateRate,
              inflationRate: settings.inflationRate,
              planStartYear: settings.planStartYear,
              planEndYear: settings.planEndYear,
            }}
          />
        </div>
      </div>
    </div>
  );
}

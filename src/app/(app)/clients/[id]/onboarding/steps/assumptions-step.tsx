import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  clients,
  scenarios,
  planSettings,
  modelPortfolios,
  modelPortfolioAllocations,
  assetClasses,
  clientCmaOverrides,
  crmHouseholdContacts,
} from "@/db/schema";
import WizardAssumptionsForm from "./wizard-assumptions-form";
import { resolveInflationRate } from "@/lib/inflation";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { controllingEntity } from "@/engine/ownership";
import { buildModelPortfolioOptions } from "@/lib/cma/model-portfolio-options";
import type { USPSStateCode } from "@/lib/usps-states";

interface AssumptionsStepProps {
  clientId: string;
  firmId: string;
}

/** Wizard step over the trimmed three-group assumptions form. The full
 * five-tab surface stays on `/clients/[id]/details/assumptions`. */
export default async function AssumptionsStep({ clientId, firmId }: AssumptionsStepProps) {
  const [clientRow] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  if (!clientRow) return <NotFound />;

  // CRM contacts — the primary's DOB gates the rest of the load, matching the
  // details-page loader this mirrors.
  const contactRows = await db
    .select()
    .from(crmHouseholdContacts)
    .where(eq(crmHouseholdContacts.householdId, clientRow.crmHouseholdId));
  const primaryContact = contactRows.find((c) => c.role === "primary");
  if (!primaryContact?.dateOfBirth) return <NotFound />;

  const [scenario] = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)));
  if (!scenario) return <NotFound />;

  const [
    settingsRows,
    portfolioRows,
    allocationRows,
    assetClassRows,
    { effectiveTree },
  ] = await Promise.all([
    db.select().from(planSettings).where(and(eq(planSettings.clientId, clientId), eq(planSettings.scenarioId, scenario.id))),
    db.select().from(modelPortfolios).where(eq(modelPortfolios.firmId, firmId)),
    db.select().from(modelPortfolioAllocations),
    db.select().from(assetClasses).where(eq(assetClasses.firmId, firmId)),
    loadEffectiveTree(clientId, firmId, "base", {}),
  ]);

  const accountRows = effectiveTree.accounts;

  const settings = settingsRows[0];
  if (!settings) return <NotFound message="No plan settings found." />;

  const [firmInflationAc] = await db
    .select({ id: assetClasses.id, geometricReturn: assetClasses.geometricReturn })
    .from(assetClasses)
    .where(and(eq(assetClasses.firmId, firmId), eq(assetClasses.slug, "inflation")));

  let clientInflationOverride: { geometricReturn: string } | null = null;
  if (settings.useCustomCma && firmInflationAc) {
    const [override] = await db
      .select({ geometricReturn: clientCmaOverrides.geometricReturn })
      .from(clientCmaOverrides)
      .where(and(eq(clientCmaOverrides.clientId, clientId), eq(clientCmaOverrides.sourceAssetClassId, firmInflationAc.id)));
    if (override) clientInflationOverride = override;
  }

  const resolvedInflationRate = resolveInflationRate(
    { inflationRateSource: settings.inflationRateSource, inflationRate: settings.inflationRate },
    firmInflationAc ?? null,
    clientInflationOverride,
  );

  const modelPortfolioOptions = buildModelPortfolioOptions(
    portfolioRows,
    allocationRows,
    assetClassRows,
  );

  // Household-owned accounts only — an entity-owned account isn't somewhere
  // household surplus can land.
  const householdAccounts = accountRows
    .filter((a) => !controllingEntity(a))
    .map((a) => ({ id: a.id, name: a.name }));

  return (
    <WizardAssumptionsForm
      clientId={clientId}
      settings={{
        residenceState: (settings.residenceState ?? null) as USPSStateCode | null,
        defaultGrowthTaxable: String(settings.defaultGrowthTaxable),
        defaultGrowthRetirement: String(settings.defaultGrowthRetirement),
        defaultGrowthCash: String(settings.defaultGrowthCash),
        growthSourceTaxable: settings.growthSourceTaxable,
        growthSourceRetirement: settings.growthSourceRetirement,
        growthSourceCash: settings.growthSourceCash,
        modelPortfolioIdTaxable: settings.modelPortfolioIdTaxable,
        modelPortfolioIdRetirement: settings.modelPortfolioIdRetirement,
        modelPortfolioIdCash: settings.modelPortfolioIdCash,
        surplusSpendPct: String(settings.surplusSpendPct ?? "0"),
        surplusSaveAccountId: settings.surplusSaveAccountId,
      }}
      modelPortfolios={modelPortfolioOptions}
      householdAccounts={householdAccounts}
      resolvedInflationRate={resolvedInflationRate}
    />
  );
}

function NotFound({ message = "No base case scenario found for this client." }: { message?: string } = {}) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-dashed border-hair-2 bg-card-2/40 px-5 py-6 text-[13px] text-ink-3">
      {message}
    </div>
  );
}

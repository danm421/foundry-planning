import { Suspense } from "react";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  clients,
  scenarios,
  familyMembers,
  entities,
  externalBeneficiaries,
  modelPortfolios,
  modelPortfolioAllocations,
  assetClasses,
  clientCmaOverrides,
  planSettings,
} from "@/db/schema";
import { loadPoliciesByAccountIds } from "@/lib/insurance-policies/load-policies";
import { resolveInflationRate } from "@/lib/inflation";
import InsurancePanel, {
  type InsurancePanelAccount,
  type InsurancePanelFamilyMember,
  type InsurancePanelEntity,
  type InsurancePanelExternal,
  type InsurancePanelModelPortfolio,
} from "@/components/insurance-panel";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { controllingEntity, controllingFamilyMember } from "@/engine/ownership";

interface InsuranceStepProps {
  clientId: string;
  firmId: string;
}

/** Wizard step over InsurancePanel. Mirrors the standard
 * `/clients/[id]/client-data/insurance/page.tsx` loader. */
export default async function InsuranceStep({ clientId, firmId }: InsuranceStepProps) {
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  if (!client) return <NotFound />;

  const [scenario] = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)));
  if (!scenario) return <NotFound />;

  const [
    familyRows,
    entityRows,
    externalRows,
    portfolioRows,
    allocationRows,
    assetClassRows,
    settingsRows,
    { effectiveTree },
  ] = await Promise.all([
    db.select().from(familyMembers).where(eq(familyMembers.clientId, clientId)).orderBy(asc(familyMembers.firstName)),
    db.select().from(entities).where(eq(entities.clientId, clientId)).orderBy(asc(entities.name)),
    db.select().from(externalBeneficiaries).where(eq(externalBeneficiaries.clientId, clientId)).orderBy(asc(externalBeneficiaries.name)),
    db.select({ id: modelPortfolios.id, name: modelPortfolios.name }).from(modelPortfolios).where(eq(modelPortfolios.firmId, firmId)).orderBy(asc(modelPortfolios.name)),
    db.select().from(modelPortfolioAllocations),
    db.select().from(assetClasses).where(eq(assetClasses.firmId, firmId)),
    db.select().from(planSettings).where(and(eq(planSettings.clientId, clientId), eq(planSettings.scenarioId, scenario.id))),
    loadEffectiveTree(clientId, firmId, "base", {}),
  ]);

  const acMap = new Map(assetClassRows.map((ac) => [ac.id, ac]));
  const blendedByPortfolio = new Map<string, number>();
  for (const p of portfolioRows) {
    const allocs = allocationRows.filter((a) => a.modelPortfolioId === p.id);
    let blended = 0;
    for (const alloc of allocs) {
      const ac = acMap.get(alloc.assetClassId);
      if (ac) blended += parseFloat(alloc.weight) * parseFloat(ac.geometricReturn);
    }
    blendedByPortfolio.set(p.id, blended);
  }

  const settings = settingsRows[0];
  const firmInflationAc = assetClassRows.find((ac) => ac.slug === "inflation") ?? null;
  let clientInflationOverride: { geometricReturn: string } | null = null;
  if (settings?.useCustomCma && firmInflationAc) {
    const [override] = await db
      .select({ geometricReturn: clientCmaOverrides.geometricReturn })
      .from(clientCmaOverrides)
      .where(and(eq(clientCmaOverrides.clientId, clientId), eq(clientCmaOverrides.sourceAssetClassId, firmInflationAc.id)));
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

  const accountRows = [...effectiveTree.accounts].sort((a, b) => a.name.localeCompare(b.name));
  const lifeAccountIds = accountRows
    .filter((a) => a.category === "life_insurance")
    .map((a) => a.id);
  const policies = await loadPoliciesByAccountIds(lifeAccountIds);

  const clientFmId = (effectiveTree.familyMembers ?? []).find((fm) => fm.role === "client")?.id ?? null;
  const spouseFmId = (effectiveTree.familyMembers ?? []).find((fm) => fm.role === "spouse")?.id ?? null;
  function ownerLabel(a: (typeof accountRows)[number]): "client" | "spouse" | "joint" {
    const cfm = controllingFamilyMember(a);
    if (cfm === spouseFmId && spouseFmId != null) return "spouse";
    if (cfm === clientFmId && clientFmId != null) return "client";
    return "joint";
  }

  const accts: InsurancePanelAccount[] = accountRows.map((a) => ({
    id: a.id,
    name: a.name,
    category: a.category,
    subType: (a.subType ?? null) as InsurancePanelAccount["subType"],
    owner: ownerLabel(a),
    ownerEntityId: controllingEntity(a) ?? null,
    insuredPerson: a.insuredPerson ?? null,
    value: String(a.value),
  }));
  const fams: InsurancePanelFamilyMember[] = familyRows.map((f) => ({
    id: f.id,
    firstName: f.firstName,
    lastName: f.lastName ?? null,
    relationship: f.relationship,
    role: f.role,
    dateOfBirth: f.dateOfBirth ?? null,
    notes: f.notes ?? null,
  }));
  const ents: InsurancePanelEntity[] = entityRows.map((e) => ({
    id: e.id,
    name: e.name,
    entityType: e.entityType,
  }));
  const exts: InsurancePanelExternal[] = externalRows.map((e) => ({
    id: e.id,
    name: e.name,
    kind: e.kind,
    notes: e.notes ?? null,
  }));
  const portfolios: InsurancePanelModelPortfolio[] = portfolioRows.map((p) => ({
    id: p.id,
    name: p.name,
    blendedReturn: blendedByPortfolio.get(p.id) ?? 0,
  }));

  return (
    <Suspense fallback={null}>
      <InsurancePanel
        clientId={clientId}
        clientFirstName={client.firstName}
        spouseFirstName={client.spouseName ?? null}
        accounts={accts}
        policies={policies}
        entities={ents}
        familyMembers={fams}
        externalBeneficiaries={exts}
        modelPortfolios={portfolios}
        resolvedInflationRate={resolvedInflationRate}
        embed="wizard"
      />
    </Suspense>
  );
}

function NotFound() {
  return (
    <div className="rounded-[var(--radius-sm)] border border-dashed border-hair-2 bg-card-2/40 px-5 py-6 text-[13px] text-ink-3">
      No base case scenario found for this client.
    </div>
  );
}

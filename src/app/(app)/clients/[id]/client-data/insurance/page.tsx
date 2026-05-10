import { notFound } from "next/navigation";
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
import { eq, and, asc } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import { loadPoliciesByAccountIds } from "@/lib/insurance-policies/load-policies";
import { resolveInflationRate } from "@/lib/inflation";
import InsurancePanel, {
  type InsurancePanelAccount,
  type InsurancePanelFamilyMember,
  type InsurancePanelEntity,
  type InsurancePanelExternal,
  type InsurancePanelModelPortfolio,
} from "@/components/insurance-panel";
import ClientDataPageShell from "@/components/client-data-page-shell";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { controllingEntity, controllingFamilyMember } from "@/engine/ownership";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scenario?: string }>;
}

export default async function InsurancePage({ params, searchParams }: PageProps) {
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
    familyRows,
    entityRows,
    externalRows,
    portfolioRows,
    allocationRows,
    assetClassRows,
    settingsRows,
    { effectiveTree },
  ] = await Promise.all([
    db
      .select()
      .from(familyMembers)
      .where(eq(familyMembers.clientId, id))
      .orderBy(asc(familyMembers.firstName)),
    db
      .select()
      .from(entities)
      .where(eq(entities.clientId, id))
      .orderBy(asc(entities.name)),
    db
      .select()
      .from(externalBeneficiaries)
      .where(eq(externalBeneficiaries.clientId, id))
      .orderBy(asc(externalBeneficiaries.name)),
    db
      .select({ id: modelPortfolios.id, name: modelPortfolios.name })
      .from(modelPortfolios)
      .where(eq(modelPortfolios.firmId, firmId))
      .orderBy(asc(modelPortfolios.name)),
    db.select().from(modelPortfolioAllocations),
    db.select().from(assetClasses).where(eq(assetClasses.firmId, firmId)),
    db
      .select()
      .from(planSettings)
      .where(and(eq(planSettings.clientId, id), eq(planSettings.scenarioId, scenario.id))),
    loadEffectiveTree(id, firmId, sp.scenario ?? "base", {}),
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

  const accountRows = [...effectiveTree.accounts].sort((a, b) => a.name.localeCompare(b.name));
  const lifeAccountIds = accountRows
    .filter((a) => a.category === "life_insurance")
    .map((a) => a.id);
  const policies = await loadPoliciesByAccountIds(lifeAccountIds);

  const _clientFmId = (effectiveTree.familyMembers ?? []).find((fm) => fm.role === "client")?.id ?? null;
  const _spouseFmId = (effectiveTree.familyMembers ?? []).find((fm) => fm.role === "spouse")?.id ?? null;
  function _ownerLabel(a: (typeof accountRows)[number]): "client" | "spouse" | "joint" {
    const cfm = controllingFamilyMember(a);
    if (cfm === _spouseFmId && _spouseFmId != null) return "spouse";
    if (cfm === _clientFmId && _clientFmId != null) return "client";
    return "joint";
  }

  const accts: InsurancePanelAccount[] = accountRows.map((a) => ({
    id: a.id,
    name: a.name,
    category: a.category,
    subType: (a.subType ?? null) as InsurancePanelAccount["subType"],
    owner: _ownerLabel(a),
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
    <ClientDataPageShell clientId={id} scenarioId={sp.scenario}>
      <InsurancePanel
        clientId={id}
        clientFirstName={client.firstName}
        spouseFirstName={client.spouseName ?? null}
        accounts={accts}
        policies={policies}
        entities={ents}
        familyMembers={fams}
        externalBeneficiaries={exts}
        modelPortfolios={portfolios}
        resolvedInflationRate={resolvedInflationRate}
      />
    </ClientDataPageShell>
  );
}

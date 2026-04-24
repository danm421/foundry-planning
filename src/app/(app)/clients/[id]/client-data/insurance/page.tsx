import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  clients,
  scenarios,
  accounts,
  familyMembers,
  entities,
  externalBeneficiaries,
} from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import { loadPoliciesByAccountIds } from "@/lib/insurance-policies/load-policies";
import InsurancePanel, {
  type InsurancePanelAccount,
  type InsurancePanelFamilyMember,
  type InsurancePanelEntity,
  type InsurancePanelExternal,
} from "@/components/insurance-panel";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function InsurancePage({ params }: PageProps) {
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

  const [accountRows, familyRows, entityRows, externalRows] = await Promise.all([
    db
      .select()
      .from(accounts)
      .where(and(eq(accounts.clientId, id), eq(accounts.scenarioId, scenario.id)))
      .orderBy(asc(accounts.name)),
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
  ]);

  const lifeAccountIds = accountRows
    .filter((a) => a.category === "life_insurance")
    .map((a) => a.id);
  const policies = await loadPoliciesByAccountIds(lifeAccountIds);

  const accts: InsurancePanelAccount[] = accountRows.map((a) => ({
    id: a.id,
    name: a.name,
    category: a.category,
    subType: a.subType ?? null,
    owner: a.owner,
    ownerEntityId: a.ownerEntityId ?? null,
    insuredPerson: a.insuredPerson ?? null,
    value: a.value,
  }));
  const fams: InsurancePanelFamilyMember[] = familyRows.map((f) => ({
    id: f.id,
    firstName: f.firstName,
    lastName: f.lastName ?? null,
    relationship: f.relationship,
  }));
  const ents: InsurancePanelEntity[] = entityRows.map((e) => ({
    id: e.id,
    name: e.name,
    entityType: e.entityType,
  }));
  const exts: InsurancePanelExternal[] = externalRows.map((e) => ({
    id: e.id,
    name: e.name,
  }));

  return (
    <InsurancePanel
      clientId={id}
      accounts={accts}
      policies={policies}
      entities={ents}
      familyMembers={fams}
      externalBeneficiaries={exts}
    />
  );
}

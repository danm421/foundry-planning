import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  clients,
  scenarios,
  familyMembers,
  externalBeneficiaries,
  entities,
} from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import WillsPanel, {
  type WillAssetMode,
  type WillsPanelAccount,
  type WillsPanelFamilyMember,
  type WillsPanelExternal,
  type WillsPanelEntity,
  type WillsPanelLiability,
  type WillsPanelWill,
  type WillsPanelPrimary,
  type WillsPanelAssetBequest,
  type WillsPanelLiabilityBequest,
} from "@/components/wills-panel";
import ClientDataPageShell from "@/components/client-data-page-shell";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { controllingEntity } from "@/engine/ownership";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scenario?: string }>;
}

export default async function WillsPage({ params, searchParams }: PageProps) {
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

  // Wills now flow through the scenario layer (so a scenario edit shows up
  // here when the user has a `?scenario=` selected). Read them from
  // `effectiveTree.wills` instead of querying the base tables directly —
  // `loadEffectiveTree` already merges scenario_changes for us.
  const [familyRows, externalRows, entityRows, { effectiveTree }] =
    await Promise.all([
      db.select().from(familyMembers).where(eq(familyMembers.clientId, id)).orderBy(asc(familyMembers.firstName)),
      db
        .select()
        .from(externalBeneficiaries)
        .where(eq(externalBeneficiaries.clientId, id))
        .orderBy(asc(externalBeneficiaries.name)),
      db.select().from(entities).where(eq(entities.clientId, id)).orderBy(asc(entities.name)),
      loadEffectiveTree(id, firmId, sp.scenario ?? "base", {}),
    ]);

  const accountRows = [...effectiveTree.accounts].sort((a, b) => a.name.localeCompare(b.name));
  const liabilityRows = [...effectiveTree.liabilities].sort((a, b) => a.name.localeCompare(b.name));

  const initialWills: WillsPanelWill[] = (effectiveTree.wills ?? [])
    .slice()
    .sort((a, b) => a.grantor.localeCompare(b.grantor))
    .map((w) => ({
      id: w.id,
      grantor: w.grantor,
      bequests: w.bequests.map((b): WillsPanelAssetBequest | WillsPanelLiabilityBequest => {
        const recipients = b.recipients.map((r) => ({
          recipientKind: r.recipientKind,
          recipientId: r.recipientId,
          percentage: r.percentage,
          sortOrder: r.sortOrder,
        }));
        if (b.kind === "liability") {
          return {
            kind: "liability",
            id: b.id,
            name: b.name,
            liabilityId: b.liabilityId,
            percentage: b.percentage,
            condition: "always",
            sortOrder: b.sortOrder,
            recipients,
          };
        }
        return {
          kind: "asset",
          id: b.id,
          name: b.name,
          assetMode: (b.assetMode ?? "all_assets") as WillAssetMode,
          accountId: b.accountId,
          percentage: b.percentage,
          condition: b.condition,
          sortOrder: b.sortOrder,
          recipients,
        };
      }),
      residuaryRecipients: w.residuaryRecipients?.map((r) => ({
        recipientKind: r.recipientKind,
        recipientId: r.recipientId,
        percentage: r.percentage,
        sortOrder: r.sortOrder,
      })),
    }));

  const primary: WillsPanelPrimary = {
    firstName: client.firstName,
    lastName: client.lastName,
    spouseName: client.spouseName ?? null,
    spouseLastName: client.spouseLastName ?? null,
  };
  const accts: WillsPanelAccount[] = accountRows.map((a) => ({
    id: a.id,
    name: a.name,
    category: a.category,
  }));
  const fams: WillsPanelFamilyMember[] = familyRows.map((f) => ({
    id: f.id,
    firstName: f.firstName,
    lastName: f.lastName ?? null,
    role: f.role,
  }));
  const exts: WillsPanelExternal[] = externalRows.map((e) => ({
    id: e.id,
    name: e.name,
  }));
  const ents: WillsPanelEntity[] = entityRows.map((e) => ({
    id: e.id,
    name: e.name,
  }));
  const liabs: WillsPanelLiability[] = liabilityRows.map((l) => ({
    id: l.id,
    name: l.name,
    balance: l.balance,
    linkedPropertyId: l.linkedPropertyId ?? null,
    ownerEntityId: controllingEntity(l) ?? null,
  }));

  return (
    <ClientDataPageShell clientId={id} scenarioId={sp.scenario}>
      <WillsPanel
        clientId={id}
        primary={primary}
        accounts={accts}
        liabilities={liabs}
        familyMembers={fams}
        externalBeneficiaries={exts}
        entities={ents}
        initialWills={initialWills}
      />
    </ClientDataPageShell>
  );
}

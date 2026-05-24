import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  clients,
  crmHouseholdContacts,
  scenarios,
  familyMembers,
  externalBeneficiaries,
  entities,
} from "@/db/schema";
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
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { controllingEntity } from "@/engine/ownership";

interface EstateStepProps {
  clientId: string;
  firmId: string;
}

/** Wizard step over WillsPanel. Mirrors the standard
 * `/clients/[id]/details/wills/page.tsx` loader. */
export default async function EstateStep({ clientId, firmId }: EstateStepProps) {
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  if (!client) return <NotFound />;

  // CRM contacts — sole identity source.
  const contactRows = await db
    .select()
    .from(crmHouseholdContacts)
    .where(eq(crmHouseholdContacts.householdId, client.crmHouseholdId));
  const primaryContact = contactRows.find((c) => c.role === "primary");
  const spouseContact = contactRows.find((c) => c.role === "spouse");
  if (!primaryContact) return <NotFound />;

  const [scenario] = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)));
  if (!scenario) return <NotFound />;

  const [familyRows, externalRows, entityRows, { effectiveTree }] = await Promise.all([
    db.select().from(familyMembers).where(eq(familyMembers.clientId, clientId)).orderBy(asc(familyMembers.firstName)),
    db.select().from(externalBeneficiaries).where(eq(externalBeneficiaries.clientId, clientId)).orderBy(asc(externalBeneficiaries.name)),
    db.select().from(entities).where(eq(entities.clientId, clientId)).orderBy(asc(entities.name)),
    loadEffectiveTree(clientId, firmId, "base", {}),
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
          entityId: b.entityId ?? null,
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
    firstName: primaryContact.firstName,
    lastName: primaryContact.lastName,
    spouseName: spouseContact?.firstName ?? null,
    spouseLastName: spouseContact?.lastName ?? null,
  };
  const entityOwnedAccountTotals = new Map<string, number>();
  for (const a of accountRows) {
    const e = controllingEntity(a);
    if (e) entityOwnedAccountTotals.set(e, (entityOwnedAccountTotals.get(e) ?? 0) + a.value);
  }
  const accts: WillsPanelAccount[] = accountRows.map((a) => ({
    id: a.id,
    name: a.name,
    category: a.category,
    ownerEntityId: controllingEntity(a) ?? null,
    value: a.value,
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
    entityType: e.entityType ?? undefined,
    value: parseFloat(e.value ?? "0") + (entityOwnedAccountTotals.get(e.id) ?? 0),
  }));
  const liabs: WillsPanelLiability[] = liabilityRows.map((l) => ({
    id: l.id,
    name: l.name,
    balance: l.balance,
    linkedPropertyId: l.linkedPropertyId ?? null,
    ownerEntityId: controllingEntity(l) ?? null,
  }));

  return (
    <WillsPanel
      clientId={clientId}
      primary={primary}
      accounts={accts}
      liabilities={liabs}
      familyMembers={fams}
      externalBeneficiaries={exts}
      entities={ents}
      initialWills={initialWills}
      embed="wizard"
    />
  );
}

function NotFound() {
  return (
    <div className="rounded-[var(--radius-sm)] border border-dashed border-hair-2 bg-card-2/40 px-5 py-6 text-[13px] text-ink-3">
      No base case scenario found for this client.
    </div>
  );
}

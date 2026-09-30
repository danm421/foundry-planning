import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  clients,
  crmHouseholdContacts,
  scenarios,
  familyMembers,
  externalBeneficiaries,
  entities,
} from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import type {
  WillAssetMode,
  WillsPanelAccount,
  WillsPanelFamilyMember,
  WillsPanelExternal,
  WillsPanelEntity,
  WillsPanelLiability,
  WillsPanelWill,
  WillsPanelPrimary,
  WillsPanelAssetBequest,
  WillsPanelLiabilityBequest,
  WillsPanelProps,
} from "@/components/wills-panel";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { controllingEntity } from "@/engine/ownership";

export type WillsViewPropsResult =
  | { status: "ok"; props: WillsPanelProps }
  | { status: "no-base-case" };

/**
 * Everything `WillsPanel` renders from, for one client and scenario. Shared by
 * the Details page and the Solver's change editor so both edit the same wills
 * off the same rows. Throws `notFound()` for an unknown client or a household
 * without a primary contact.
 */
export async function loadWillsViewProps(
  clientId: string,
  scenarioParam: string | undefined,
): Promise<WillsViewPropsResult> {
  // The body below moved here verbatim from `WillsContent`, which named it `id`.
  const id = clientId;
  const firmId = await getOrgId();

  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
  if (!client) notFound();

  // CRM contacts — sole identity source for the wills panel header.
  const contactRows = await db
    .select()
    .from(crmHouseholdContacts)
    .where(eq(crmHouseholdContacts.householdId, client.crmHouseholdId));
  const primaryContact = contactRows.find((c) => c.role === "primary");
  const spouseContact = contactRows.find((c) => c.role === "spouse");
  if (!primaryContact) notFound();

  const [scenario] = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.clientId, id), eq(scenarios.isBaseCase, true)));

  if (!scenario) {
    return { status: "no-base-case" };
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
      loadEffectiveTree(id, firmId, scenarioParam ?? "base", {}),
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
        tier: r.tier,
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

  return {
    status: "ok",
    props: {
      clientId: id,
      primary,
      accounts: accts,
      liabilities: liabs,
      familyMembers: fams,
      externalBeneficiaries: exts,
      entities: ents,
      initialWills,
    },
  };
}

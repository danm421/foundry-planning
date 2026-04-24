import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  clients,
  scenarios,
  accounts,
  familyMembers,
  externalBeneficiaries,
  entities,
  wills,
  willBequests,
  willBequestRecipients,
} from "@/db/schema";
import { eq, and, asc, inArray } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import WillsPanel, {
  type WillAssetMode,
  type WillsPanelAccount,
  type WillsPanelFamilyMember,
  type WillsPanelExternal,
  type WillsPanelEntity,
  type WillsPanelWill,
  type WillsPanelPrimary,
} from "@/components/wills-panel";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function WillsPage({ params }: PageProps) {
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

  const [willRows, accountRows, familyRows, externalRows, entityRows] =
    await Promise.all([
      db.select().from(wills).where(eq(wills.clientId, id)).orderBy(asc(wills.grantor)),
      db
        .select()
        .from(accounts)
        .where(and(eq(accounts.clientId, id), eq(accounts.scenarioId, scenario.id)))
        .orderBy(asc(accounts.name)),
      db.select().from(familyMembers).where(eq(familyMembers.clientId, id)).orderBy(asc(familyMembers.firstName)),
      db
        .select()
        .from(externalBeneficiaries)
        .where(eq(externalBeneficiaries.clientId, id))
        .orderBy(asc(externalBeneficiaries.name)),
      db.select().from(entities).where(eq(entities.clientId, id)).orderBy(asc(entities.name)),
    ]);

  const willIds = willRows.map((w) => w.id);
  const bequestRows = willIds.length
    ? await db
        .select()
        .from(willBequests)
        .where(inArray(willBequests.willId, willIds))
        .orderBy(asc(willBequests.willId), asc(willBequests.sortOrder))
    : [];
  const bequestIds = bequestRows.map((b) => b.id);
  const recipientRows = bequestIds.length
    ? await db
        .select()
        .from(willBequestRecipients)
        .where(inArray(willBequestRecipients.bequestId, bequestIds))
        .orderBy(asc(willBequestRecipients.bequestId), asc(willBequestRecipients.sortOrder))
    : [];

  const recipientsByBequest = new Map<string, typeof recipientRows>();
  for (const r of recipientRows) {
    const list = recipientsByBequest.get(r.bequestId) ?? [];
    list.push(r);
    recipientsByBequest.set(r.bequestId, list);
  }
  const bequestsByWill = new Map<string, WillsPanelWill["bequests"]>();
  for (const b of bequestRows) {
    // Task 13 will render liability bequests in a separate Debt bequests section.
    if (b.kind === "liability") continue;
    const list = bequestsByWill.get(b.willId) ?? [];
    list.push({
      id: b.id,
      name: b.name,
      assetMode: (b.assetMode ?? "all_assets") as WillAssetMode,
      accountId: b.accountId,
      percentage: parseFloat(b.percentage),
      condition: b.condition,
      sortOrder: b.sortOrder,
      recipients: (recipientsByBequest.get(b.id) ?? []).map((r) => ({
        id: r.id,
        recipientKind: r.recipientKind,
        recipientId: r.recipientId,
        percentage: parseFloat(r.percentage),
        sortOrder: r.sortOrder,
      })),
    });
    bequestsByWill.set(b.willId, list);
  }

  const initialWills: WillsPanelWill[] = willRows.map((w) => ({
    id: w.id,
    grantor: w.grantor,
    bequests: bequestsByWill.get(w.id) ?? [],
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
  }));
  const exts: WillsPanelExternal[] = externalRows.map((e) => ({
    id: e.id,
    name: e.name,
  }));
  const ents: WillsPanelEntity[] = entityRows.map((e) => ({
    id: e.id,
    name: e.name,
  }));

  return (
    <WillsPanel
      clientId={id}
      primary={primary}
      accounts={accts}
      familyMembers={fams}
      externalBeneficiaries={exts}
      entities={ents}
      initialWills={initialWills}
    />
  );
}

import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  clients,
  familyMembers,
  entities,
  externalBeneficiaries,
  beneficiaryDesignations,
  gifts,
} from "@/db/schema";
import { eq, and, asc, notInArray } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import FamilyView, {
  FamilyMember,
  Entity,
  NamePctRow,
  PrimaryInfo,
  ExternalBeneficiary,
  AccountLite,
  Designation,
} from "@/components/family-view";
import OpenItemsPanel from "@/components/open-items/open-items-panel";
import ClientDataPageShell from "@/components/client-data-page-shell";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { controllingEntity, controllingFamilyMember } from "@/engine/ownership";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scenario?: string }>;
}

export default async function FamilyPage({ params, searchParams }: PageProps) {
  const firmId = await getOrgId();
  const { id } = await params;
  const sp = await searchParams;

  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

  if (!client) notFound();

  const [memberRows, entityRows, externalRows, designationRows, giftRows, { effectiveTree }] =
    await Promise.all([
      db
        .select()
        .from(familyMembers)
        .where(
          and(
            eq(familyMembers.clientId, id),
            notInArray(familyMembers.role, ["client", "spouse"]),
          ),
        )
        .orderBy(asc(familyMembers.relationship), asc(familyMembers.firstName)),
      db.select().from(entities).where(eq(entities.clientId, id)).orderBy(asc(entities.name)),
      db
        .select()
        .from(externalBeneficiaries)
        .where(eq(externalBeneficiaries.clientId, id))
        .orderBy(asc(externalBeneficiaries.name)),
      db
        .select()
        .from(beneficiaryDesignations)
        .where(eq(beneficiaryDesignations.clientId, id))
        .orderBy(asc(beneficiaryDesignations.tier), asc(beneficiaryDesignations.sortOrder)),
      db
        .select()
        .from(gifts)
        .where(eq(gifts.clientId, id))
        .orderBy(asc(gifts.year), asc(gifts.createdAt)),
      loadEffectiveTree(id, firmId, sp.scenario ?? "base", {}),
    ]);

  const accountRows = [...effectiveTree.accounts].sort((a, b) => a.name.localeCompare(b.name));
  const effectiveClient = effectiveTree.client;

  const members: FamilyMember[] = memberRows.map((m) => ({
    id: m.id,
    firstName: m.firstName,
    lastName: m.lastName ?? null,
    relationship: m.relationship,
    dateOfBirth: m.dateOfBirth ?? null,
    notes: m.notes ?? null,
  }));

  const ents: Entity[] = entityRows.map((e) => ({
    id: e.id,
    name: e.name,
    entityType: e.entityType,
    notes: e.notes ?? null,
    includeInPortfolio: e.includeInPortfolio,
    isGrantor: e.isGrantor,
    value: String(e.value ?? "0"),
    owner: (e.owner as "client" | "spouse" | "joint" | null) ?? null,
    grantor: (e.grantor as "client" | "spouse" | null) ?? null,
    beneficiaries: (e.beneficiaries as NamePctRow[] | null) ?? null,
    trustSubType: e.trustSubType ?? null,
    isIrrevocable: e.isIrrevocable ?? null,
    trustee: e.trustee ?? null,
    trustEnds: (e.trustEnds as "client_death" | "spouse_death" | "survivorship" | null) ?? null,
    distributionMode: (e.distributionMode as "fixed" | "pct_liquid" | "pct_income" | null) ?? null,
    distributionAmount: e.distributionAmount != null ? parseFloat(String(e.distributionAmount)) : null,
    distributionPercent: e.distributionPercent != null ? parseFloat(String(e.distributionPercent)) : null,
  }));

  const externals: ExternalBeneficiary[] = externalRows.map((e) => ({
    id: e.id,
    name: e.name,
    kind: e.kind,
    notes: e.notes ?? null,
  }));

  const accts: AccountLite[] = accountRows.map((a) => ({
    id: a.id,
    name: a.name,
    category: a.category,
    ownerFamilyMemberId: controllingFamilyMember(a) ?? null,
    ownerEntityId: controllingEntity(a) ?? null,
  }));

  // Full asset data for the trust Assets tab
  const fullAccounts = (effectiveTree.accounts ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    value: a.value,
    subType: a.subType,
    isDefaultChecking: a.isDefaultChecking,
    owners: a.owners,
  }));
  const fullLiabilities = (effectiveTree.liabilities ?? []).map((l) => ({
    id: l.id,
    name: l.name,
    balance: l.balance,
    owners: l.owners,
  }));
  const fullIncomes = (effectiveTree.incomes ?? []).map((i) => ({
    id: i.id,
    name: i.name,
    annualAmount: i.annualAmount,
    cashAccountId: i.cashAccountId,
  }));
  const fullExpenses = (effectiveTree.expenses ?? []).map((e) => ({
    id: e.id,
    name: e.name,
    annualAmount: e.annualAmount,
    cashAccountId: e.cashAccountId,
  }));
  const assetFamilyMembers = memberRows.map((m) => ({
    id: m.id,
    role: (m.role as "client" | "spouse" | "child" | "other"),
    firstName: m.firstName,
  }));

  const designations: Designation[] = designationRows.map((d) => ({
    id: d.id,
    targetKind: d.targetKind,
    accountId: d.accountId,
    entityId: d.entityId,
    tier: d.tier,
    familyMemberId: d.familyMemberId,
    externalBeneficiaryId: d.externalBeneficiaryId,
    entityIdRef: d.entityIdRef ?? null,
    householdRole: (d.householdRole as "client" | "spouse" | null) ?? null,
    percentage: parseFloat(d.percentage),
    sortOrder: d.sortOrder,
  }));

  // FamilyView's gift list shows cash gifts only — asset/liability transfers
  // (post-migration-0057, these have null amount) are surfaced in the trust
  // dialog Transfers tab instead.
  // FamilyView's gift list shows cash gifts only — asset/liability transfers
  // (post-migration-0057, these have null amount) are surfaced in the trust
  // dialog Transfers tab instead.
  const giftsList = giftRows
    .filter((g) => g.amount != null)
    .map((g) => ({
      id: g.id,
      year: g.year,
      amount: parseFloat(g.amount as string),
      grantor: g.grantor,
      recipientEntityId: g.recipientEntityId ?? null,
      recipientFamilyMemberId: g.recipientFamilyMemberId ?? null,
      recipientExternalBeneficiaryId: g.recipientExternalBeneficiaryId ?? null,
      useCrummeyPowers: g.useCrummeyPowers,
      notes: g.notes ?? null,
    }));

  const primary: PrimaryInfo = {
    firstName: effectiveClient.firstName,
    lastName: effectiveClient.lastName,
    dateOfBirth: effectiveClient.dateOfBirth,
    retirementAge: effectiveClient.retirementAge,
    lifeExpectancy: effectiveClient.lifeExpectancy ?? client.lifeExpectancy,
    filingStatus: effectiveClient.filingStatus,
    spouseName: effectiveClient.spouseName ?? null,
    spouseLastName: client.spouseLastName ?? null,
    spouseDob: effectiveClient.spouseDob ?? null,
    spouseRetirementAge: effectiveClient.spouseRetirementAge ?? null,
    spouseLifeExpectancy: effectiveClient.spouseLifeExpectancy ?? null,
  };

  return (
    <ClientDataPageShell clientId={id} scenarioId={sp.scenario}>
      <FamilyView
        clientId={id}
        primary={primary}
        initialMembers={members}
        initialEntities={ents}
        initialExternalBeneficiaries={externals}
        initialAccounts={accts}
        initialDesignations={designations}
        initialGifts={giftsList}
        initialFullAccounts={fullAccounts}
        initialFullLiabilities={fullLiabilities}
        initialFullIncomes={fullIncomes}
        initialFullExpenses={fullExpenses}
        initialAssetFamilyMembers={assetFamilyMembers}
      />
      <OpenItemsPanel clientId={id} firmId={firmId} />
    </ClientDataPageShell>
  );
}

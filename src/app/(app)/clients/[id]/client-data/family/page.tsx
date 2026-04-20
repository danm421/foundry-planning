import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  clients,
  familyMembers,
  entities,
  accounts,
  externalBeneficiaries,
  beneficiaryDesignations,
  gifts,
} from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
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

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function FamilyPage({ params }: PageProps) {
  const firmId = await getOrgId();
  const { id } = await params;

  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

  if (!client) notFound();

  const [memberRows, entityRows, externalRows, accountRows, designationRows, giftRows] =
    await Promise.all([
      db
        .select()
        .from(familyMembers)
        .where(eq(familyMembers.clientId, id))
        .orderBy(asc(familyMembers.relationship), asc(familyMembers.firstName)),
      db.select().from(entities).where(eq(entities.clientId, id)).orderBy(asc(entities.name)),
      db
        .select()
        .from(externalBeneficiaries)
        .where(eq(externalBeneficiaries.clientId, id))
        .orderBy(asc(externalBeneficiaries.name)),
      db.select().from(accounts).where(eq(accounts.clientId, id)).orderBy(asc(accounts.name)),
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
    ]);

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
    grantors: (e.grantors as NamePctRow[] | null) ?? null,
    beneficiaries: (e.beneficiaries as NamePctRow[] | null) ?? null,
    trustSubType: e.trustSubType ?? null,
    isIrrevocable: e.isIrrevocable ?? null,
    trustee: e.trustee ?? null,
    exemptionConsumed: String(e.exemptionConsumed ?? "0"),
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
    ownerFamilyMemberId: a.ownerFamilyMemberId ?? null,
    ownerEntityId: a.ownerEntityId ?? null,
  }));

  const designations: Designation[] = designationRows.map((d) => ({
    id: d.id,
    targetKind: d.targetKind,
    accountId: d.accountId,
    entityId: d.entityId,
    tier: d.tier,
    familyMemberId: d.familyMemberId,
    externalBeneficiaryId: d.externalBeneficiaryId,
    percentage: parseFloat(d.percentage),
    sortOrder: d.sortOrder,
  }));

  const giftsList = giftRows.map((g) => ({
    id: g.id,
    year: g.year,
    amount: parseFloat(g.amount),
    grantor: g.grantor,
    recipientEntityId: g.recipientEntityId ?? null,
    recipientFamilyMemberId: g.recipientFamilyMemberId ?? null,
    recipientExternalBeneficiaryId: g.recipientExternalBeneficiaryId ?? null,
    useCrummeyPowers: g.useCrummeyPowers,
    notes: g.notes ?? null,
  }));

  const primary: PrimaryInfo = {
    firstName: client.firstName,
    lastName: client.lastName,
    dateOfBirth: client.dateOfBirth,
    retirementAge: client.retirementAge,
    lifeExpectancy: client.lifeExpectancy,
    filingStatus: client.filingStatus,
    spouseName: client.spouseName ?? null,
    spouseLastName: client.spouseLastName ?? null,
    spouseDob: client.spouseDob ?? null,
    spouseRetirementAge: client.spouseRetirementAge ?? null,
    spouseLifeExpectancy: client.spouseLifeExpectancy ?? null,
  };

  return (
    <FamilyView
      clientId={id}
      primary={primary}
      initialMembers={members}
      initialEntities={ents}
      initialExternalBeneficiaries={externals}
      initialAccounts={accts}
      initialDesignations={designations}
      initialGifts={giftsList}
    />
  );
}

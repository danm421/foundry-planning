import { notFound } from "next/navigation";
import { db } from "@/db";
import { clients, familyMembers, entities } from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import FamilyView, { FamilyMember, Entity, NamePctRow, PrimaryInfo } from "@/components/family-view";

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

  const [memberRows, entityRows] = await Promise.all([
    db
      .select()
      .from(familyMembers)
      .where(eq(familyMembers.clientId, id))
      .orderBy(asc(familyMembers.relationship), asc(familyMembers.firstName)),
    db.select().from(entities).where(eq(entities.clientId, id)).orderBy(asc(entities.name)),
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
  }));

  const primary: PrimaryInfo = {
    firstName: client.firstName,
    lastName: client.lastName,
    dateOfBirth: client.dateOfBirth,
    retirementAge: client.retirementAge,
    planEndAge: client.planEndAge,
    filingStatus: client.filingStatus,
    spouseName: client.spouseName ?? null,
    spouseLastName: client.spouseLastName ?? null,
    spouseDob: client.spouseDob ?? null,
    spouseRetirementAge: client.spouseRetirementAge ?? null,
  };

  return <FamilyView clientId={id} primary={primary} initialMembers={members} initialEntities={ents} />;
}

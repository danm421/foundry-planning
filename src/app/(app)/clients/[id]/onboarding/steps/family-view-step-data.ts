import { db } from "@/db";
import {
  familyMembers,
  entities,
  entityOwners,
  externalBeneficiaries,
  beneficiaryDesignations,
  gifts,
} from "@/db/schema";
import { eq, and, asc, inArray, notInArray } from "drizzle-orm";
import type {
  FamilyMember,
  Entity,
  ExternalBeneficiary,
  AccountLite,
  Designation,
  PrimaryInfo,
  NamePctRow,
} from "@/components/family-view";
import type { ClientData } from "@/engine/types";
import { controllingEntity, controllingFamilyMember } from "@/engine/ownership";

/** Bundle of props both the Family and Entities wizard steps render against.
 * Mirrors the loader shape used by `family-step.tsx` before Phase 3 — kept as
 * a single helper because the two steps render `<FamilyView />` with
 * different `section` props over the same data. */
export interface FamilyViewStepData {
  primary: PrimaryInfo;
  members: FamilyMember[];
  ents: Entity[];
  externals: ExternalBeneficiary[];
  accts: AccountLite[];
  designations: Designation[];
  giftsList: {
    id: string;
    year: number;
    amount: number;
    grantor: "client" | "spouse" | "joint";
    recipientEntityId: string | null;
    recipientFamilyMemberId: string | null;
    recipientExternalBeneficiaryId: string | null;
    useCrummeyPowers: boolean;
    notes: string | null;
  }[];
}

export async function loadFamilyViewStepData(
  clientId: string,
  tree: ClientData,
): Promise<FamilyViewStepData> {
  const [memberRows, entityRows, externalRows, designationRows, giftRows] = await Promise.all([
    db
      .select()
      .from(familyMembers)
      .where(and(eq(familyMembers.clientId, clientId), notInArray(familyMembers.role, ["client", "spouse"])))
      .orderBy(asc(familyMembers.relationship), asc(familyMembers.firstName)),
    db.select().from(entities).where(eq(entities.clientId, clientId)).orderBy(asc(entities.name)),
    db.select().from(externalBeneficiaries).where(eq(externalBeneficiaries.clientId, clientId)),
    db.select().from(beneficiaryDesignations).where(eq(beneficiaryDesignations.clientId, clientId)),
    db.select().from(gifts).where(eq(gifts.clientId, clientId)).orderBy(asc(gifts.year)),
  ]);

  const entityIds = entityRows.map((e) => e.id);
  const ownerRows =
    entityIds.length > 0
      ? await db.select().from(entityOwners).where(inArray(entityOwners.entityId, entityIds))
      : [];
  const ownersByEntity = new Map<string, { kind: "family_member"; familyMemberId: string; percent: number }[]>();
  for (const o of ownerRows) {
    const arr = ownersByEntity.get(o.entityId) ?? [];
    arr.push({ kind: "family_member", familyMemberId: o.familyMemberId, percent: parseFloat(o.percent) });
    ownersByEntity.set(o.entityId, arr);
  }

  const members: FamilyMember[] = memberRows.map((m) => ({
    id: m.id,
    firstName: m.firstName,
    lastName: m.lastName ?? null,
    relationship: m.relationship,
    role: m.role,
    dateOfBirth: m.dateOfBirth ?? null,
    notes: m.notes ?? null,
    domesticPartner: m.domesticPartner,
    inheritanceClassOverride: m.inheritanceClassOverride ?? {},
  }));

  const ents: Entity[] = entityRows.map((e) => ({
    id: e.id,
    name: e.name,
    entityType: e.entityType,
    notes: e.notes ?? null,
    includeInPortfolio: e.includeInPortfolio,
    isGrantor: e.isGrantor,
    value: String(e.value ?? "0"),
    basis: String(e.basis ?? "0"),
    owners: ownersByEntity.get(e.id) ?? [],
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
    taxTreatment: e.taxTreatment ?? undefined,
    distributionPolicyPercent: e.distributionPolicyPercent != null ? Number(e.distributionPolicyPercent) : null,
    flowMode: e.flowMode,
    valueGrowthRate: e.valueGrowthRate != null ? Number(e.valueGrowthRate) : null,
  }));

  const externals: ExternalBeneficiary[] = externalRows.map((e) => ({
    id: e.id,
    name: e.name,
    kind: e.kind,
    notes: e.notes ?? null,
  }));

  const accts: AccountLite[] = tree.accounts.map((a) => ({
    id: a.id,
    name: a.name,
    category: a.category,
    ownerFamilyMemberId: controllingFamilyMember(a) ?? null,
    ownerEntityId: controllingEntity(a) ?? null,
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

  const c = tree.client;
  const primary: PrimaryInfo = {
    firstName: c.firstName,
    lastName: c.lastName,
    dateOfBirth: c.dateOfBirth,
    retirementAge: c.retirementAge,
    retirementMonth: 1,
    lifeExpectancy: c.lifeExpectancy ?? 95,
    filingStatus: c.filingStatus,
    spouseName: c.spouseName ?? null,
    spouseLastName: null,
    spouseDob: c.spouseDob ?? null,
    spouseRetirementAge: c.spouseRetirementAge ?? null,
    spouseRetirementMonth: null,
    spouseLifeExpectancy: c.spouseLifeExpectancy ?? null,
  };

  return { primary, members, ents, externals, accts, designations, giftsList };
}

import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  clients,
  crmHouseholdContacts,
  familyMembers,
  entities,
  entityOwners,
  externalBeneficiaries,
  beneficiaryDesignations,
  gifts,
  giftSeries,
  taxYearParameters,
  scenarios as scenariosTable,
} from "@/db/schema";
import { eq, and, asc, inArray, notInArray } from "drizzle-orm";
import { buildAnnualExclusionMap } from "@/lib/gifts/resolve-annual-exclusion";
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
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { buildFamilyPrimary } from "./family-primary";
import { controllingEntity, controllingFamilyMember } from "@/engine/ownership";
import { getClientWithContacts } from "@/lib/clients/get-client-with-contacts";

interface FamilyContentProps {
  clientId: string;
  scenarioParam: string | undefined;
}

export async function FamilyContent({ clientId: id, scenarioParam }: FamilyContentProps) {
  const firmId = await getOrgId();

  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

  if (!client) notFound();

  // CRM contacts — source of spouseLastName (and other identity fallbacks).
  const contactRows = await db
    .select()
    .from(crmHouseholdContacts)
    .where(eq(crmHouseholdContacts.householdId, client.crmHouseholdId));
  const spouseContact = contactRows.find((c) => c.role === "spouse") ?? null;

  const [memberRows, allMemberRows, entityRows, externalRows, designationRows, giftRows, { effectiveTree }, contacts, scenarioRows] =
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
      db
        .select()
        .from(familyMembers)
        .where(eq(familyMembers.clientId, id)),
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
      loadEffectiveTree(id, firmId, scenarioParam ?? "base", {}),
      getClientWithContacts(id, firmId),
      db
        .select({
          id: scenariosTable.id,
          name: scenariosTable.name,
          isBaseCase: scenariosTable.isBaseCase,
        })
        .from(scenariosTable)
        .innerJoin(clients, eq(clients.id, scenariosTable.clientId))
        .where(and(eq(scenariosTable.clientId, id), eq(clients.firmId, firmId))),
    ]);

  const accountRows = [...effectiveTree.accounts].sort((a, b) => a.name.localeCompare(b.name));
  const effectiveClient = effectiveTree.client;

  const resolvedScenario =
    (scenarioParam ?? "base") === "base"
      ? scenarioRows.find((s) => s.isBaseCase)
      : scenarioRows.find((s) => s.id === (scenarioParam ?? "base"));
  if (!resolvedScenario) notFound();

  const [giftSeriesRows, taxRows] = await Promise.all([
    db
      .select()
      .from(giftSeries)
      .where(and(eq(giftSeries.clientId, id), eq(giftSeries.scenarioId, resolvedScenario.id)))
      .orderBy(asc(giftSeries.startYear)),
    db
      .select({ year: taxYearParameters.year, giftAnnualExclusion: taxYearParameters.giftAnnualExclusion })
      .from(taxYearParameters)
      .orderBy(asc(taxYearParameters.year)),
  ]);

  const entityIds = entityRows.map((e) => e.id);
  const ownerRows = entityIds.length > 0
    ? await db.select().from(entityOwners).where(inArray(entityOwners.entityId, entityIds))
    : [];
  // Polymorphic per-entity owner map. Rows have exactly one of
  // familyMemberId / ownerEntityId populated (CHECK constraint).
  const ownersByEntity = new Map<
    string,
    Array<
      | { kind: "family_member"; familyMemberId: string; percent: number }
      | { kind: "entity"; entityId: string; percent: number }
    >
  >();
  for (const o of ownerRows) {
    const arr = ownersByEntity.get(o.entityId) ?? [];
    if (o.familyMemberId) {
      arr.push({ kind: "family_member", familyMemberId: o.familyMemberId, percent: parseFloat(o.percent) });
    } else if (o.ownerEntityId) {
      arr.push({ kind: "entity", entityId: o.ownerEntityId, percent: parseFloat(o.percent) });
    }
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
    // `revocable` is a deprecated DB-enum orphan no longer in the TrustSubType
    // union (revocable trusts are modeled as a tag now). Legacy rows may still
    // carry it — map it to null so it fits the narrowed Entity type.
    trustSubType:
      e.trustSubType != null && e.trustSubType !== "revocable" ? e.trustSubType : null,
    isIrrevocable: e.isIrrevocable ?? null,
    trustee: e.trustee ?? null,
    trustEnds: (e.trustEnds as "client_death" | "spouse_death" | "survivorship" | null) ?? null,
    distributionMode: (e.distributionMode as "fixed" | "pct_liquid" | "pct_income" | null) ?? null,
    distributionAmount: e.distributionAmount != null ? parseFloat(String(e.distributionAmount)) : null,
    distributionPercent: e.distributionPercent != null ? parseFloat(String(e.distributionPercent)) : null,
    taxTreatment: e.taxTreatment ?? undefined,
    distributionPolicyPercent: e.distributionPolicyPercent != null
      ? Number(e.distributionPolicyPercent)
      : null,
    flowMode: e.flowMode,
    valueGrowthRate: e.valueGrowthRate != null ? Number(e.valueGrowthRate) : null,
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
    ownerEntityId: i.ownerEntityId ?? null,
    startYear: i.startYear,
    endYear: i.endYear,
    growthRate: i.growthRate,
    growthSource: i.growthSource ?? null,
    inflationStartYear: i.inflationStartYear ?? null,
  }));
  const fullExpenses = (effectiveTree.expenses ?? []).map((e) => ({
    id: e.id,
    name: e.name,
    annualAmount: e.annualAmount,
    cashAccountId: e.cashAccountId,
    ownerEntityId: e.ownerEntityId ?? null,
    startYear: e.startYear,
    endYear: e.endYear,
    growthRate: e.growthRate,
    growthSource: e.growthSource ?? null,
    inflationStartYear: e.inflationStartYear ?? null,
  }));
  const assetFamilyMembers = allMemberRows.map((m) => ({
    id: m.id,
    role: (m.role as "client" | "spouse" | "child" | "other"),
    firstName: m.firstName,
  }));

  // Business entities available to assign to a trust via the Assets-tab picker.
  // Trust entries themselves are excluded — only business-type entities can be
  // transferred to a trust as a §709-style gifted interest.
  const BUSINESS_ENTITY_TYPES = new Set([
    "llc",
    "s_corp",
    "c_corp",
    "partnership",
    "other",
  ]);
  const fullBusinesses = entityRows
    .filter((e) => BUSINESS_ENTITY_TYPES.has(e.entityType))
    .map((e) => ({
      id: e.id,
      name: e.name,
      value: e.value != null ? parseFloat(String(e.value)) : 0,
      // ownersByEntity rows are already polymorphic family_member | entity —
      // matches the EntityOwner discriminated union the picker expects.
      owners: ownersByEntity.get(e.id) ?? [],
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
    distributionForm: d.distributionForm ?? null,
    percentage: parseFloat(d.percentage),
    sortOrder: d.sortOrder,
  }));

  const giftsList = giftRows
    .filter((g) => g.parentGiftId == null) // hide auto-bundled liability child rows
    .map((g) => ({
      id: g.id,
      year: g.year,
      amount: g.amount != null ? parseFloat(g.amount as string) : null,
      grantor: g.grantor,
      recipientEntityId: g.recipientEntityId ?? null,
      recipientFamilyMemberId: g.recipientFamilyMemberId ?? null,
      recipientExternalBeneficiaryId: g.recipientExternalBeneficiaryId ?? null,
      accountId: g.accountId ?? null,
      percent: g.percent != null ? parseFloat(g.percent as string) : null,
      useCrummeyPowers: g.useCrummeyPowers,
      notes: g.notes ?? null,
    }));

  const giftSeriesList = giftSeriesRows.map((s) => ({
    id: s.id,
    grantor: s.grantor as "client" | "spouse" | "joint",
    recipientEntityId: s.recipientEntityId,
    recipientFamilyMemberId: s.recipientFamilyMemberId,
    recipientExternalBeneficiaryId: s.recipientExternalBeneficiaryId,
    startYear: s.startYear,
    endYear: s.endYear,
    annualAmount: parseFloat(s.annualAmount as string),
    amountMode: (s.amountMode ?? "fixed") as "fixed" | "annual_exclusion",
    inflationAdjust: s.inflationAdjust,
    useCrummeyPowers: s.useCrummeyPowers,
  }));

  const planStartYear = effectiveTree.planSettings.planStartYear;
  const annualExclusionByYear = buildAnnualExclusionMap(
    taxRows,
    planStartYear,
    planStartYear + 40,
    0.025, // display-only inflation assumption; engine uses the exact plan rate
  );

  // Every client field — including retirementMonth / spouseRetirementMonth —
  // comes from the EFFECTIVE client so scenario overrides flow through. Only
  // spouseLastName is sourced outside the tree (from the CRM contact).
  const primary: PrimaryInfo = buildFamilyPrimary(
    effectiveClient,
    spouseContact?.lastName ?? null,
  );

  return (
    <>
      <FamilyView
        clientId={id}
        primary={primary}
        initialMembers={members}
        initialEntities={ents}
        initialExternalBeneficiaries={externals}
        initialAccounts={accts}
        initialDesignations={designations}
        initialGifts={giftsList}
        initialGiftSeries={giftSeriesList}
        annualExclusionByYear={annualExclusionByYear}
        scenarioId={resolvedScenario.id}
        initialFullAccounts={fullAccounts}
        initialFullLiabilities={fullLiabilities}
        initialFullIncomes={fullIncomes}
        initialFullExpenses={fullExpenses}
        initialFullBusinesses={fullBusinesses}
        initialAssetFamilyMembers={assetFamilyMembers}
        contacts={contacts}
      />
      <OpenItemsPanel clientId={id} firmId={firmId} />
    </>
  );
}

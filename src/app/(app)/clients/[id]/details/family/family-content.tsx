import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  clients,
  crmHouseholdContacts,
  familyMembers,
  entities,
  externalBeneficiaries,
  beneficiaryDesignations,
  gifts,
  giftSeries,
  taxYearParameters,
  scenarios as scenariosTable,
} from "@/db/schema";
import { eq, and, asc, notInArray } from "drizzle-orm";
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
import { loadActiveGiftChanges } from "@/lib/scenario/changes";
import { buildFamilyPrimary } from "./family-primary";
import { entitySummaryToRow, overlayScenarioGiftRows } from "./family-scenario-rows";
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

  const [giftSeriesRows, taxRows, giftChanges] = await Promise.all([
    db
      .select()
      .from(giftSeries)
      .where(and(eq(giftSeries.clientId, id), eq(giftSeries.scenarioId, resolvedScenario.id)))
      .orderBy(asc(giftSeries.startYear)),
    db
      .select({ year: taxYearParameters.year, giftAnnualExclusion: taxYearParameters.giftAnnualExclusion })
      .from(taxYearParameters)
      .orderBy(asc(taxYearParameters.year)),
    loadActiveGiftChanges(resolvedScenario.id),
  ]);

  // The three `entities` columns the engine's EntitySummary doesn't carry.
  // Keyed by id so a trust that exists only as a scenario change simply has no
  // entry and falls back to the row builder's defaults.
  const entityExtras = new Map(
    entityRows.map((e) => [
      e.id,
      {
        notes: e.notes ?? null,
        owner: (e.owner as "client" | "spouse" | "joint" | null) ?? null,
        beneficiaries: (e.beneficiaries as NamePctRow[] | null) ?? null,
      },
    ]),
  );

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
    claimedAsDependent: m.claimedAsDependent,
  }));

  // Sourced from the effective tree, not the `entities` table: that table has
  // no scenario column, so a trust added in the solver and saved to a scenario
  // would otherwise never appear here. The tree already carries the scenario's
  // entity adds/edits/removes.
  const ents: Entity[] = (effectiveTree.entities ?? [])
    .map((e) => entitySummaryToRow(e, entityExtras.get(e.id)))
    .sort((a, b) => a.name.localeCompare(b.name));

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
    value: a.value,
    subType: a.subType,
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
  // Off the effective tree rather than `entityRows` so a business added in a
  // scenario is assignable to a trust in that same scenario. Read from the tree
  // (not `ents`) because EntitySummary.owners is already the narrow
  // family_member | entity union the picker expects.
  const fullBusinesses = (effectiveTree.entities ?? [])
    .filter((e) => e.entityType != null && BUSINESS_ENTITY_TYPES.has(e.entityType))
    .map((e) => ({
      id: e.id,
      name: e.name ?? "",
      value: e.value ?? 0,
      owners: e.owners ?? [],
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

  const baseGiftsList = giftRows
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
      valuationDiscount:
        g.valuationDiscount != null ? parseFloat(g.valuationDiscount as string) : null,
      useCrummeyPowers: g.useCrummeyPowers,
      notes: g.notes ?? null,
    }));

  const baseGiftSeriesList = giftSeriesRows.map((s) => ({
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
    valuationDiscount:
      s.valuationDiscount != null ? parseFloat(s.valuationDiscount as string) : null,
    useCrummeyPowers: s.useCrummeyPowers,
  }));

  // Neither `gifts` nor a solver-saved gift lives in a scenario-scoped table the
  // way `gift_series` does, so the scenario's own `gift` changes are overlaid on
  // top — the same set the projection already counted.
  const { gifts: giftsList, series: giftSeriesList } = overlayScenarioGiftRows(
    baseGiftsList,
    baseGiftSeriesList,
    giftChanges,
  );

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

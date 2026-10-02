import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  clients,
  crmHouseholdContacts,
  familyMembers,
  entities,
  externalBeneficiaries,
  gifts,
  giftSeries,
  taxYearParameters,
  scenarios as scenariosTable,
} from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { buildAnnualExclusionMap } from "@/lib/gifts/resolve-annual-exclusion";
import { getOrgId } from "@/lib/db-helpers";
import type {
  FamilyViewProps,
  FamilyMember,
  Entity,
  NamePctRow,
  PrimaryInfo,
  ExternalBeneficiary,
  AccountLite,
  Designation,
} from "@/components/family-view";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { loadActiveGiftChanges } from "@/lib/scenario/changes";
import { buildFamilyPrimary } from "./family-primary";
import { entitySummaryToRow, overlayScenarioGiftRows } from "@/lib/gifts/scenario-rows";
import type { BeneficiaryRef, EntitySummary } from "@/engine/types";
import { controllingEntity, controllingFamilyMember } from "@/engine/ownership";
import { getClientWithContacts } from "@/lib/clients/get-client-with-contacts";

export interface FamilyViewPropsResult {
  props: FamilyViewProps;
  /** For the `OpenItemsPanel` the page renders beside the view. */
  firmId: string;
}

/**
 * Everything `FamilyView` renders from, for one client and scenario. Shared by
 * the Details page and the Solver's change editor so both open the same
 * dialogs off the same rows. Throws `notFound()` for an unknown client or a
 * scenario that doesn't resolve.
 */
export async function loadFamilyViewProps(
  clientId: string,
  scenarioParam: string | undefined,
): Promise<FamilyViewPropsResult> {
  // The body below moved here verbatim from `FamilyContent`, which named it `id`.
  const id = clientId;
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

  // The base member and charity rows are read only for `notes`, which the
  // engine's FamilyMember / ExternalBeneficiary don't carry: everything the
  // page lists comes from the effective tree below.
  const [baseMemberRows, entityRows, baseExternalRows, giftRows, { effectiveTree }, contacts, scenarioRows] =
    await Promise.all([
      db
        .select({ id: familyMembers.id, notes: familyMembers.notes })
        .from(familyMembers)
        .where(eq(familyMembers.clientId, id)),
      db.select().from(entities).where(eq(entities.clientId, id)).orderBy(asc(entities.name)),
      db
        .select({ id: externalBeneficiaries.id, notes: externalBeneficiaries.notes })
        .from(externalBeneficiaries)
        .where(eq(externalBeneficiaries.clientId, id)),
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
  // A scenario-added trust carries these as extra keys on its payload, which the
  // effective tree keeps at runtime, so the tree's value wins over the base row's.
  const baseEntityExtras = new Map(
    entityRows.map((e) => [
      e.id,
      {
        notes: e.notes ?? null,
        owner: (e.owner as "client" | "spouse" | "joint" | null) ?? null,
        beneficiaries: (e.beneficiaries as NamePctRow[] | null) ?? null,
      },
    ]),
  );
  const entityExtrasFor = (e: EntitySummary) => {
    const base = baseEntityExtras.get(e.id);
    const runtime = e as EntitySummary & { owner?: "client" | "spouse" | "joint" | null };
    // `beneficiaries` on the tree is the engine's BeneficiaryRef list, a different
    // shape from this page's name/percentage rows: only the latter is taken.
    const treeRows = (e.beneficiaries ?? []) as unknown as Array<Record<string, unknown>>;
    const nameRows = treeRows.length > 0 && treeRows.every((r) => "name" in r);
    return {
      notes: e.notes ?? base?.notes ?? null,
      owner: runtime.owner ?? base?.owner ?? null,
      beneficiaries: nameRows ? (treeRows as unknown as NamePctRow[]) : (base?.beneficiaries ?? null),
    };
  };

  // Members and charities come from the effective tree too: neither table is
  // scenario-scoped, so one added or edited in a scenario would otherwise be
  // invisible here (and an edit would open on base values).
  const baseNotes = new Map(baseMemberRows.map((m) => [m.id, m.notes]));
  const treeMembers = effectiveTree.familyMembers ?? [];
  const members: FamilyMember[] = treeMembers
    .filter((m) => m.role !== "client" && m.role !== "spouse")
    .map((m) => ({
      id: m.id,
      firstName: m.firstName,
      lastName: m.lastName ?? null,
      relationship: m.relationship,
      role: m.role ?? "other",
      dateOfBirth: m.dateOfBirth ?? null,
      // `notes` isn't on the engine type: a scenario add/edit carries it as an
      // extra key, otherwise the base row's.
      notes: (m as { notes?: string | null }).notes ?? baseNotes.get(m.id) ?? null,
      domesticPartner: m.domesticPartner ?? false,
      inheritanceClassOverride: m.inheritanceClassOverride ?? {},
      claimedAsDependent: m.claimedAsDependent ?? "auto",
    }))
    .sort(
      (a, b) =>
        a.relationship.localeCompare(b.relationship) || a.firstName.localeCompare(b.firstName),
    );

  // Sourced from the effective tree, not the `entities` table: that table has
  // no scenario column, so a trust added in the solver and saved to a scenario
  // would otherwise never appear here. The tree already carries the scenario's
  // entity adds/edits/removes.
  const ents: Entity[] = (effectiveTree.entities ?? [])
    .map((e) => entitySummaryToRow(e, entityExtrasFor(e)))
    .sort((a, b) => a.name.localeCompare(b.name));

  const baseExternalNotes = new Map(baseExternalRows.map((e) => [e.id, e.notes]));
  const externals: ExternalBeneficiary[] = (effectiveTree.externalBeneficiaries ?? [])
    .map((e) => ({
      id: e.id,
      name: e.name,
      kind: e.kind,
      notes: (e as { notes?: string | null }).notes ?? baseExternalNotes.get(e.id) ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const accts: AccountLite[] = accountRows.map((a) => ({
    id: a.id,
    name: a.name,
    category: a.category,
    value: a.value,
    subType: a.subType,
    ownerFamilyMemberId: controllingFamilyMember(a) ?? null,
    ownerEntityId: controllingEntity(a) ?? null,
    beneficiaries: a.beneficiaries,
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
  const assetFamilyMembers = treeMembers.map((m) => ({
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

  // Off the effective tree, so a scenario's beneficiary edits show here and the
  // trust dialog opens on them. Accounts and trusts carry primary/contingent
  // rows (with their stored ids); a trust's income and remainder tiers are the
  // data-only lists the loader builds from the same table.
  const designations: Designation[] = [];
  const fromRef = (
    r: BeneficiaryRef,
    target: Pick<Designation, "targetKind" | "accountId" | "entityId">,
  ): Designation => ({
    id: r.id,
    ...target,
    tier: r.tier,
    familyMemberId: r.familyMemberId ?? null,
    externalBeneficiaryId: r.externalBeneficiaryId ?? null,
    entityIdRef: r.entityIdRef ?? null,
    householdRole: r.householdRole ?? null,
    percentage: r.percentage,
    sortOrder: r.sortOrder,
  });
  for (const a of effectiveTree.accounts) {
    for (const r of a.beneficiaries ?? []) {
      designations.push(fromRef(r, { targetKind: "account", accountId: a.id, entityId: null }));
    }
  }
  for (const e of effectiveTree.entities ?? []) {
    const target = { targetKind: "trust", accountId: null, entityId: e.id } as const;
    for (const r of e.beneficiaries ?? []) designations.push(fromRef(r, target));
    (e.incomeBeneficiaries ?? []).forEach((r, i) =>
      designations.push({
        id: `${e.id}:income:${i}`,
        ...target,
        tier: "income",
        familyMemberId: r.familyMemberId ?? null,
        externalBeneficiaryId: r.externalBeneficiaryId ?? null,
        entityIdRef: r.entityId ?? null,
        householdRole: r.householdRole ?? null,
        percentage: r.percentage,
        sortOrder: i,
      }),
    );
    (e.remainderBeneficiaries ?? []).forEach((r, i) =>
      designations.push({
        id: `${e.id}:remainder:${i}`,
        ...target,
        tier: "remainder",
        familyMemberId: r.familyMemberId ?? null,
        externalBeneficiaryId: r.externalBeneficiaryId ?? null,
        entityIdRef: r.entityIdRef ?? null,
        householdRole: r.householdRole ?? null,
        distributionForm: r.distributionForm ?? null,
        percentage: r.percentage,
        sortOrder: i,
      }),
    );
  }

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
      // The three columns the gift dialog needs to seed an edit truthfully.
      // `eventKind` keeps a CLT's remainder-interest gift from being rewritten
      // as an ordinary outright gift; the other two mark the rows that have no
      // draft shape at all, so the dialog refuses them instead of re-saving
      // them as a $0 cash gift.
      eventKind: g.eventKind,
      businessEntityId: g.businessEntityId ?? null,
      liabilityId: g.liabilityId ?? null,
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

  return {
    props: {
      clientId: id,
      primary,
      initialMembers: members,
      initialEntities: ents,
      initialExternalBeneficiaries: externals,
      initialAccounts: accts,
      initialDesignations: designations,
      initialGifts: giftsList,
      initialGiftSeries: giftSeriesList,
      annualExclusionByYear,
      planStartYear,
      scenarioId: resolvedScenario.id,
      initialFullAccounts: fullAccounts,
      initialFullLiabilities: fullLiabilities,
      initialFullIncomes: fullIncomes,
      initialFullExpenses: fullExpenses,
      initialFullBusinesses: fullBusinesses,
      initialAssetFamilyMembers: assetFamilyMembers,
      contacts,
    },
    firmId,
  };
}

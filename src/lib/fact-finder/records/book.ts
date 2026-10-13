// src/lib/fact-finder/records/book.ts
/**
 * The record book: the client's base-case records as the placement diff reads
 * them — each value under its TARGETS key, encoded the way the section maps
 * write it (numbers as numbers, rates as fractions, dates "YYYY-MM-DD",
 * choices as enum values, people and records as RecordRefs, timing as a year
 * or { yearRef }). Every query is scoped by the client — and by the scenario
 * where the table has one; child tables are read only through their scoped
 * parents' ids. Server-only: it reads the database.
 */
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  beneficiaryDesignations,
  crmHouseholdContacts,
  disabilityPolicies,
  entities,
  expenses,
  externalBeneficiaries,
  familyMembers,
  gifts,
  incomes,
  ltcPolicies,
  planObservations,
  planSettings,
  revocableTrusts,
  savingsRules,
  willBequestRecipients,
  willBequests,
  willResiduaryRecipients,
  wills,
} from "@/db/schema";
import { getClientWithContacts } from "@/lib/clients/get-client-with-contacts";
import { livingSlotRole } from "@/lib/imports/match-keys/living-slot";
import type { PlacedValue, RecordRef, TargetKind } from "../change-set";
import { emptyRecordBook, type BookRecord, type RecordBook } from "../placement/types";

type Role = "client" | "spouse";

const record = (target: TargetKind, id: string): RecordRef => ({ ref: "record", target, id });
const person = (role: Role): RecordRef => ({ ref: "person", role });
const num = (value: string | null): number | null => (value === null ? null : Number(value));
const timing = (year: number, yearRef: string | null): PlacedValue => (yearRef ? { yearRef } : year);
/** A growth rate is in effect only when the row's growth source is "custom" (the maps write it with that companion). */
const customRate = (rate: string, source: string): number | null => (source === "custom" ? Number(rate) : null);
const fullName = (first: string | null, last: string | null) => [first, last].filter(Boolean).join(" ");

/** Accounts that are their own target rather than `account`. */
const ACCOUNT_TARGET: Readonly<Record<string, TargetKind>> = {
  business: "business_account",
  life_insurance: "life_insurance_policy",
  stock_options: "stock_option_account",
};

/**
 * The client's records in one scenario — the base case (Task 19 passes
 * `resolveBaseCaseScenarioId`); null = the client has none, so only the
 * client-level records load. Throws when the client isn't in the firm.
 */
export async function loadRecordBook(clientId: string, firmId: string, scenarioId: string | null): Promise<RecordBook> {
  const client = await getClientWithContacts(clientId, firmId);
  if (!client) throw new Error("Client not found");

  const [
    contacts, family, externals, trusts, revocables, willRows, giftRows, notes, disability, ltc,
    settings, accountRows, incomeRows, expenseRows, savingsRows,
  ] = await Promise.all([
    db
      .select()
      .from(crmHouseholdContacts)
      .where(and(eq(crmHouseholdContacts.householdId, client.crmHouseholdId), inArray(crmHouseholdContacts.role, ["primary", "spouse", "other"]))),
    db.select().from(familyMembers).where(eq(familyMembers.clientId, clientId)),
    db.select().from(externalBeneficiaries).where(eq(externalBeneficiaries.clientId, clientId)),
    db.select().from(entities).where(and(eq(entities.clientId, clientId), eq(entities.entityType, "trust"))),
    db.select().from(revocableTrusts).where(eq(revocableTrusts.clientId, clientId)),
    db.select().from(wills).where(eq(wills.clientId, clientId)),
    db.select().from(gifts).where(and(eq(gifts.clientId, clientId), isNull(gifts.parentGiftId))),
    db.select().from(planObservations).where(and(eq(planObservations.clientId, clientId), eq(planObservations.section, "observation"))),
    db.select().from(disabilityPolicies).where(eq(disabilityPolicies.clientId, clientId)),
    db.select().from(ltcPolicies).where(eq(ltcPolicies.clientId, clientId)),
    scenarioId
      ? db.select().from(planSettings).where(and(eq(planSettings.clientId, clientId), eq(planSettings.scenarioId, scenarioId))).limit(1)
      : [],
    scenarioId
      ? db
          .select({ id: accounts.id, name: accounts.name, category: accounts.category })
          .from(accounts)
          .where(and(eq(accounts.clientId, clientId), eq(accounts.scenarioId, scenarioId)))
      : [],
    scenarioId ? db.select().from(incomes).where(and(eq(incomes.clientId, clientId), eq(incomes.scenarioId, scenarioId))) : [],
    scenarioId ? db.select().from(expenses).where(and(eq(expenses.clientId, clientId), eq(expenses.scenarioId, scenarioId))) : [],
    scenarioId ? db.select().from(savingsRules).where(and(eq(savingsRules.clientId, clientId), eq(savingsRules.scenarioId, scenarioId))) : [],
  ]);

  // Child tables, only through the parents just read.
  const trustIds = trusts.map((t) => t.id);
  const willIds = willRows.map((w) => w.id);
  const [designations, bequests, residuary] = await Promise.all([
    trustIds.length > 0
      ? db
          .select()
          .from(beneficiaryDesignations)
          .where(and(eq(beneficiaryDesignations.clientId, clientId), eq(beneficiaryDesignations.targetKind, "trust"), inArray(beneficiaryDesignations.entityId, trustIds)))
          .orderBy(asc(beneficiaryDesignations.sortOrder))
      : [],
    willIds.length > 0 ? db.select().from(willBequests).where(inArray(willBequests.willId, willIds)).orderBy(asc(willBequests.sortOrder)) : [],
    // Primary recipients only: the fact finder's "Remaining estate" has no contingent tier.
    willIds.length > 0
      ? db
          .select()
          .from(willResiduaryRecipients)
          .where(and(inArray(willResiduaryRecipients.willId, willIds), eq(willResiduaryRecipients.tier, "primary")))
          .orderBy(asc(willResiduaryRecipients.sortOrder))
      : [],
  ]);
  const bequestIds = bequests.map((b) => b.id);
  const bequestRecipients =
    bequestIds.length > 0
      ? await db.select().from(willBequestRecipients).where(inArray(willBequestRecipients.bequestId, bequestIds)).orderBy(asc(willBequestRecipients.sortOrder))
      : [];

  const people = {
    client: family.find((f) => f.role === "client")?.id ?? null,
    spouse: family.find((f) => f.role === "spouse")?.id ?? null,
  };
  const names = { client: client.firstName, spouse: client.spouseFirstName };
  /** A family member as the maps name them: the client and co-client by role. */
  const member = (id: string): RecordRef =>
    id === people.client ? person("client") : id === people.spouse ? person("spouse") : record("family_member", id);
  const accountById = new Map(accountRows.map((a) => [a.id, a]));
  const accountRef = (id: string) => record(ACCOUNT_TARGET[accountById.get(id)?.category ?? ""] ?? "account", id);
  const contactOf = (role: "primary" | "spouse") => contacts.find((c) => c.role === role);
  const willOf = new Map(willRows.map((w) => [w.id, w]));
  const willLabel = (grantor: Role) => `${names[grantor] ?? (grantor === "client" ? "Client" : "Co-client")}'s will`;
  /** A will recipient. "spouse" is the grantor's spouse — the other household principal. */
  const recipient = (kind: string, id: string | null, grantor: Role): RecordRef =>
    kind === "spouse"
      ? person(grantor === "client" ? "spouse" : "client")
      : kind === "family_member"
        ? member(String(id))
        : record(kind === "entity" ? "entity" : "external_beneficiary", String(id));

  const records: Partial<Record<TargetKind, BookRecord[]>> = {
    client_household: [{
      id: clientId,
      label: fullName(client.firstName, client.lastName) || "Household",
      values: {
        firstName: client.firstName,
        lastName: client.lastName,
        dateOfBirth: client.dateOfBirth,
        retirementAge: client.retirementAge,
        retirementMonth: client.retirementMonth,
        lifeExpectancy: client.lifeExpectancy,
        email: client.email,
        phone: client.phone,
        mobile: client.mobile,
        employer: contactOf("primary")?.employer ?? null,
        spouseName: client.spouseFirstName,
        spouseLastName: client.spouseLastName,
        spouseDob: client.spouseDateOfBirth,
        spouseRetirementAge: client.spouseRetirementAge,
        spouseRetirementMonth: client.spouseRetirementMonth,
        spouseLifeExpectancy: client.spouseLifeExpectancy,
        spouseEmail: client.spouseEmail,
        spousePhone: client.spousePhone,
        spouseMobile: client.spouseMobile,
        spouseEmployer: contactOf("spouse")?.employer ?? null,
        filingStatus: client.filingStatus,
        addressLine1: client.addressLine1,
        addressLine2: client.addressLine2,
        city: client.city,
        state: client.state,
        postalCode: client.postalCode,
      },
    }],
    plan_settings_tax_rates: settings.map((s) => ({
      id: s.id,
      label: "Tax settings",
      values: {
        coveredByWorkplacePlan: client.coveredByWorkplacePlan,
        spouseCoveredByWorkplacePlan: client.spouseCoveredByWorkplacePlan,
        residenceState: s.residenceState,
      },
    })),
    family_member: family
      .filter((f) => f.role !== "client" && f.role !== "spouse")
      .map((f) => ({
        id: f.id,
        label: fullName(f.firstName, f.lastName),
        values: {
          firstName: f.firstName,
          lastName: f.lastName,
          relationship: f.relationship,
          dateOfBirth: f.dateOfBirth,
          claimedAsDependent: f.claimedAsDependent,
          domesticPartner: f.domesticPartner,
          notes: f.notes,
        },
      })),
    external_beneficiary: externals.map((e) => ({
      id: e.id,
      label: e.name,
      values: { name: e.name, kind: e.kind, charityType: e.charityType, notes: e.notes },
    })),
    related_party: contacts
      .filter((c) => c.role === "other")
      .map((c) => ({
        id: c.id,
        label: fullName(c.firstName, c.lastName),
        values: { firstName: c.firstName, lastName: c.lastName, employer: c.employer, notes: c.notes },
      })),
    income: incomeRows.map((r) => ({
      id: r.id,
      label: r.name,
      values: {
        name: r.name,
        type: r.type,
        owner: r.owner,
        annualAmount: Number(r.annualAmount),
        growthRate: customRate(r.growthRate, r.growthSource),
        start: timing(r.startYear, r.startYearRef),
        end: timing(r.endYear, r.endYearRef),
        taxType: r.taxType,
        paymentMonth: r.paymentMonth,
        survivorshipPct: num(r.survivorshipPct),
        ssBenefitMode: r.ssBenefitMode,
        piaMonthly: num(r.piaMonthly),
        ssStatedAge: r.ssStatedAge,
        claimingAgeMode: r.claimingAgeMode,
        claimingAge: r.claimingAge,
        claimingAgeMonths: r.claimingAgeMonths,
      },
      facts: { type: r.type, owner: r.owner, ownerAccountId: r.ownerAccountId },
    })),
    expense: expenseRows.map((r) => ({
      id: r.id,
      label: r.name,
      values: {
        name: r.name,
        type: r.type,
        annualAmount: Number(r.annualAmount),
        growthRate: customRate(r.growthRate, r.growthSource),
        start: timing(r.startYear, r.startYearRef),
        end: timing(r.endYear, r.endYearRef),
        isGoal: r.isGoal,
        livingItems: r.livingItems?.map(({ name, amount, frequency }) => ({ name, amount, frequency })) ?? null,
      },
      facts: {
        type: r.type,
        livingSlot: r.type === "living" && r.isDefault ? livingSlotRole(r.startYearRef) : null,
        ownerAccountId: r.ownerAccountId,
      },
    })),
    savings_rule: savingsRows.map((r) => ({
      id: r.id,
      label: accountById.get(r.accountId)?.name ?? "Planned savings",
      values: {
        accountId: accountRef(r.accountId),
        contributeMax: r.contributeMax,
        // The engine reads IRS maximum, else a percent above 0, else the amount; what it ignores reads blank.
        annualAmount: r.contributeMax || Number(r.annualPercent) > 0 ? null : Number(r.annualAmount),
        annualPercent: r.contributeMax ? null : num(r.annualPercent),
        rothPercent: num(r.rothPercent),
        employerMatchPct: num(r.employerMatchPct),
        employerMatchCap: num(r.employerMatchCap),
        employerMatchAmount: num(r.employerMatchAmount),
        start: timing(r.startYear, r.startYearRef),
        end: timing(r.endYear, r.endYearRef),
        growthRate: customRate(r.growthRate, r.growthSource),
      },
      facts: { accountId: r.accountId },
    })),
    disability_policy: disability.map((p) => ({
      id: p.id,
      label: p.name,
      values: {
        name: p.name,
        carrier: p.carrier,
        insured: p.insured,
        coveredEarningsMode: p.coveredEarningsMode,
        coveredEarningsAmount: num(p.coveredEarningsAmount),
        hasShortTerm: p.hasShortTerm,
        stdEliminationDays: p.stdEliminationDays,
        stdBenefitPct: Number(p.stdBenefitPct),
        stdDurationWeeks: p.stdDurationWeeks,
        stdMonthlyMax: num(p.stdMonthlyMax),
        hasLongTerm: p.hasLongTerm,
        ltdEliminationDays: p.ltdEliminationDays,
        ltdBenefitPct: Number(p.ltdBenefitPct),
        ltdMonthlyMax: num(p.ltdMonthlyMax),
        ltdBenefitPeriodMode: p.ltdBenefitPeriodMode,
        ltdBenefitPeriodAge: p.ltdBenefitPeriodAge,
        ltdBenefitPeriodYears: p.ltdBenefitPeriodYears,
        benefitTaxable: p.benefitTaxable,
        colaRate: Number(p.colaRate),
        annualPremium: Number(p.annualPremium),
        premiumPayer: p.premiumPayer,
        notes: p.notes,
      },
    })),
    ltc_policy: ltc.map((p) => ({
      id: p.id,
      label: p.name,
      values: {
        name: p.name,
        carrier: p.carrier,
        insured: p.insured,
        kind: p.kind,
        lifePolicyAccountId: p.lifePolicyAccountId ? record("life_insurance_policy", p.lifePolicyAccountId) : null,
        issueYear: p.issueYear,
        benefitAmount: Number(p.benefitAmount),
        benefitUnit: p.benefitUnit,
        benefitPeriodMode: p.benefitPeriodMode,
        benefitPeriodYears: p.benefitPeriodYears,
        eliminationDays: p.eliminationDays,
        homeCarePct: Number(p.homeCarePct),
        benefitType: p.benefitType,
        sharedCare: p.sharedCare,
        partnership: p.partnership,
        inflationRider: p.inflationRider,
        inflationRate: Number(p.inflationRate),
        annualPremium: Number(p.annualPremium),
        premiumPayMode: p.premiumPayMode,
        premiumPayToAge: p.premiumPayToAge,
        premiumPayYears: p.premiumPayYears,
        notes: p.notes,
      },
    })),
    entity: trusts.map((t) => ({
      id: t.id,
      label: t.name,
      values: {
        name: t.name,
        trustSubType: t.trustSubType,
        // No grantor = a third party's trust: TRUST_GRANTOR_MAP's "Someone else".
        grantor: t.grantor ?? "none",
        trustee: t.trustee,
        isGrantor: t.isGrantor,
        crummeyPowers: t.crummeyPowers,
        trustEnds: t.trustEnds,
        notes: t.notes,
      },
      facts: { trustSubType: t.trustSubType },
    })),
    // One set per trust, empty when it names nobody — so a trust's line always finds its record.
    trust_beneficiary_designation: trusts.map((t) => ({
      id: t.id,
      label: t.name,
      values: {
        beneficiaries: designations
          .filter((d) => d.entityId === t.id)
          .flatMap((d) => {
            const who = d.householdRole
              ? person(d.householdRole)
              : d.familyMemberId
                ? member(d.familyMemberId)
                : d.externalBeneficiaryId
                  ? record("external_beneficiary", d.externalBeneficiaryId)
                  : d.entityIdRef
                    ? record("entity", d.entityIdRef)
                    : null;
            return who ? [{ tier: d.tier, who, percentage: Number(d.percentage) }] : [];
          }),
      },
    })),
    revocable_trust: revocables.map((t) => ({ id: t.id, label: t.name, values: { name: t.name } })),
    will: willRows.map((w) => ({ id: w.id, label: willLabel(w.grantor), values: { grantor: w.grantor }, facts: { grantor: w.grantor } })),
    will_bequest: bequests.map((b) => {
      const grantor = willOf.get(b.willId)?.grantor ?? "client";
      return {
        id: b.id,
        label: b.name,
        values: {
          kind: b.kind,
          accountId: b.accountId ? accountRef(b.accountId) : null,
          liabilityId: b.liabilityId ? record("liability", b.liabilityId) : null,
          percentage: Number(b.percentage),
          recipients: bequestRecipients
            .filter((r) => r.bequestId === b.id)
            .map((r) => ({ who: recipient(r.recipientKind, r.recipientId, grantor), percentage: Number(r.percentage) })),
          condition: b.condition,
        },
        facts: {
          willId: b.willId,
          grantor,
          assetKey: b.accountId
            ? `account:${b.accountId}`
            : b.liabilityId
              ? `liability:${b.liabilityId}`
              : b.entityId
                ? `entity:${b.entityId}`
                : null,
        },
      };
    }),
    // One set per will, empty when it names nobody.
    will_residuary_recipient: willRows.map((w) => ({
      id: w.id,
      label: `${willLabel(w.grantor)} — remaining estate`,
      values: {
        recipients: residuary
          .filter((r) => r.willId === w.id)
          .map((r) => ({ who: recipient(r.recipientKind, r.recipientId, w.grantor), percentage: Number(r.percentage) })),
      },
    })),
    gift: giftRows.map((g) => ({
      id: g.id,
      label: `${g.year} gift`,
      values: {
        year: g.year,
        grantor: g.grantor,
        recipient: g.recipientFamilyMemberId
          ? member(g.recipientFamilyMemberId)
          : g.recipientEntityId
            ? record("entity", g.recipientEntityId)
            : g.recipientExternalBeneficiaryId
              ? record("external_beneficiary", g.recipientExternalBeneficiaryId)
              : null,
        amount: num(g.amount),
        notes: g.notes,
      },
    })),
    plan_observation: notes.map((n) => ({ id: n.id, label: n.title ?? n.body, values: { topic: n.topic, body: n.body } })),
  };

  const book = emptyRecordBook(clientId);
  return { ...book, scenarioId, people, names, records: { ...book.records, ...records } };
}

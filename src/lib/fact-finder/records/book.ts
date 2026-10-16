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
  accountHoldings,
  accountOwners,
  accounts,
  annuityContracts,
  beneficiaryDesignations,
  crmHouseholdContacts,
  disabilityPolicies,
  entities,
  expenses,
  externalBeneficiaries,
  familyMembers,
  gifts,
  incomes,
  liabilities,
  liabilityOwners,
  lifeInsurancePolicies,
  ltcPolicies,
  noteReceivableOwners,
  notesReceivable,
  planObservations,
  planSettings,
  revocableTrusts,
  savingsRules,
  stockOptionAccounts,
  stockOptionGrants,
  stockOptionVestTranches,
  willBequestRecipients,
  willBequests,
  willResiduaryRecipients,
  wills,
} from "@/db/schema";
import type { AccountOwner } from "@/engine/ownership";
import { getClientWithContacts } from "@/lib/clients/get-client-with-contacts";
import type { DbOrTx } from "@/lib/db-tx";
import { livingSlotRole } from "@/lib/imports/match-keys/living-slot";
import { ownerRefFromOwners } from "@/lib/insurance-policies/owner-ref";
import type { PlacedValue, RecordRef, TargetKind } from "../change-set";
import { fullName, willLabel, withLast4 } from "../placement/text";
import { emptyRecordBook, type BookRecord, type RecordBook } from "../placement/types";
import { holdingValue } from "../state";

type Role = "client" | "spouse";
type Account = typeof accounts.$inferSelect;
type Designation = typeof beneficiaryDesignations.$inferSelect;
/** A row of account_owners, note_receivable_owners or liability_owners. */
type OwnerRow = { familyMemberId: string | null; entityId: string | null; externalBeneficiaryId?: string | null; percent: string };

const record = (target: TargetKind, id: string): RecordRef => ({ ref: "record", target, id });
const person = (role: Role): RecordRef => ({ ref: "person", role });
const num = (value: string | null): number | null => (value === null ? null : Number(value));
const timing = (year: number, yearRef: string | null): PlacedValue => (yearRef ? { yearRef } : year);
/** A growth rate is in effect only when the row's growth source is "custom" (the maps write it with that companion). */
const customRate = (rate: string | null, source: string): number | null => (source === "custom" ? num(rate) : null);
const monthYear = (year: number | null, month: number | null): string | null =>
  year === null || month === null ? null : `${year}-${String(month).padStart(2, "0")}`;
/** The client and co-client first, then everyone else as stored. */
const householdRank = (who: RecordRef) => (who.ref !== "person" ? 2 : who.role === "client" ? 0 : 1);

/** A position as the maps write it. 0 is the column default for a fund held by value (no share count, no price). */
function holding(h: typeof accountHoldings.$inferSelect): PlacedValue {
  const shares = Number(h.shares) || null;
  const price = Number(h.price) || null;
  return {
    ticker: h.displayTicker,
    name: h.displayName,
    shares,
    price,
    // A ticker stores no market value: it is worth shares × price.
    marketValue: holdingValue({ marketValue: h.marketValue !== null ? Number(h.marketValue) : null, shares, price }),
    costBasis: Number(h.costBasis),
  };
}

function engineOwner(o: OwnerRow): AccountOwner {
  const percent = Number(o.percent);
  if (o.familyMemberId) return { kind: "family_member", familyMemberId: o.familyMemberId, percent };
  if (o.entityId) return { kind: "entity", entityId: o.entityId, percent };
  return { kind: "external_beneficiary", externalBeneficiaryId: String(o.externalBeneficiaryId), percent };
}

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
 * `handle`: the save's transaction, so the book is what that transaction sees.
 */
export async function loadRecordBook(clientId: string, firmId: string, scenarioId: string | null, handle?: DbOrTx): Promise<RecordBook> {
  const q = handle ?? db;
  const client = await getClientWithContacts(clientId, firmId, handle);
  if (!client) throw new Error("Client not found");

  const [
    contacts, family, externals, trusts, revocables, willRows, giftRows, notes, disability, ltc,
    settings, accountRows, incomeRows, expenseRows, savingsRows, liabilityRows, noteRows,
  ] = await Promise.all([
    q
      .select()
      .from(crmHouseholdContacts)
      .where(and(eq(crmHouseholdContacts.householdId, client.crmHouseholdId), inArray(crmHouseholdContacts.role, ["primary", "spouse", "other"]))),
    q.select().from(familyMembers).where(eq(familyMembers.clientId, clientId)),
    q.select().from(externalBeneficiaries).where(eq(externalBeneficiaries.clientId, clientId)),
    q.select().from(entities).where(and(eq(entities.clientId, clientId), eq(entities.entityType, "trust"))),
    q.select().from(revocableTrusts).where(eq(revocableTrusts.clientId, clientId)),
    q.select().from(wills).where(eq(wills.clientId, clientId)),
    q.select().from(gifts).where(and(eq(gifts.clientId, clientId), isNull(gifts.parentGiftId))),
    q.select().from(planObservations).where(and(eq(planObservations.clientId, clientId), eq(planObservations.section, "observation"))),
    q.select().from(disabilityPolicies).where(eq(disabilityPolicies.clientId, clientId)),
    q.select().from(ltcPolicies).where(eq(ltcPolicies.clientId, clientId)),
    scenarioId
      ? q.select().from(planSettings).where(and(eq(planSettings.clientId, clientId), eq(planSettings.scenarioId, scenarioId))).limit(1)
      : [],
    scenarioId ? q.select().from(accounts).where(and(eq(accounts.clientId, clientId), eq(accounts.scenarioId, scenarioId))) : [],
    scenarioId ? q.select().from(incomes).where(and(eq(incomes.clientId, clientId), eq(incomes.scenarioId, scenarioId))) : [],
    scenarioId ? q.select().from(expenses).where(and(eq(expenses.clientId, clientId), eq(expenses.scenarioId, scenarioId))) : [],
    scenarioId ? q.select().from(savingsRules).where(and(eq(savingsRules.clientId, clientId), eq(savingsRules.scenarioId, scenarioId))) : [],
    scenarioId ? q.select().from(liabilities).where(and(eq(liabilities.clientId, clientId), eq(liabilities.scenarioId, scenarioId))) : [],
    scenarioId
      ? q.select().from(notesReceivable).where(and(eq(notesReceivable.clientId, clientId), eq(notesReceivable.scenarioId, scenarioId)))
      : [],
  ]);

  // Child tables, only through the parents just read.
  const trustIds = trusts.map((t) => t.id);
  const willIds = willRows.map((w) => w.id);
  const accountIds = accountRows.map((a) => a.id);
  const idsOf = (category: Account["category"]) => accountRows.filter((a) => a.category === category).map((a) => a.id);
  const [annuityIds, stockIds, policyIds] = [idsOf("annuity"), idsOf("stock_options"), idsOf("life_insurance")];
  const noteIds = noteRows.map((n) => n.id);
  const liabilityIds = liabilityRows.map((l) => l.id);
  const [
    designations, bequests, residuary, accountOwnerRows, holdingRows, accountDesignations, contracts, stockAccounts, grants,
    policies, noteOwnerRows, liabilityOwnerRows,
  ] = await Promise.all([
    trustIds.length > 0
      ? q
          .select()
          .from(beneficiaryDesignations)
          .where(and(eq(beneficiaryDesignations.clientId, clientId), eq(beneficiaryDesignations.targetKind, "trust"), inArray(beneficiaryDesignations.entityId, trustIds)))
          .orderBy(asc(beneficiaryDesignations.sortOrder))
      : [],
    willIds.length > 0 ? q.select().from(willBequests).where(inArray(willBequests.willId, willIds)).orderBy(asc(willBequests.sortOrder)) : [],
    // Primary recipients only: the fact finder's "Remaining estate" has no contingent tier.
    willIds.length > 0
      ? q
          .select()
          .from(willResiduaryRecipients)
          .where(and(inArray(willResiduaryRecipients.willId, willIds), eq(willResiduaryRecipients.tier, "primary")))
          .orderBy(asc(willResiduaryRecipients.sortOrder))
      : [],
    accountIds.length > 0 ? q.select().from(accountOwners).where(inArray(accountOwners.accountId, accountIds)) : [],
    // Sort order, then id: the save's writer reads positions in this order too, so two lots of one ticker pair with the same rows.
    accountIds.length > 0
      ? q.select().from(accountHoldings).where(inArray(accountHoldings.accountId, accountIds)).orderBy(asc(accountHoldings.sortOrder), asc(accountHoldings.id))
      : [],
    accountIds.length > 0
      ? q
          .select()
          .from(beneficiaryDesignations)
          .where(and(eq(beneficiaryDesignations.clientId, clientId), eq(beneficiaryDesignations.targetKind, "account"), inArray(beneficiaryDesignations.accountId, accountIds)))
          .orderBy(asc(beneficiaryDesignations.sortOrder))
      : [],
    annuityIds.length > 0 ? q.select().from(annuityContracts).where(inArray(annuityContracts.accountId, annuityIds)) : [],
    stockIds.length > 0 ? q.select().from(stockOptionAccounts).where(inArray(stockOptionAccounts.accountId, stockIds)) : [],
    stockIds.length > 0
      ? q.select().from(stockOptionGrants).where(inArray(stockOptionGrants.accountId, stockIds)).orderBy(asc(stockOptionGrants.sortOrder))
      : [],
    policyIds.length > 0 ? q.select().from(lifeInsurancePolicies).where(inArray(lifeInsurancePolicies.accountId, policyIds)) : [],
    noteIds.length > 0 ? q.select().from(noteReceivableOwners).where(inArray(noteReceivableOwners.noteReceivableId, noteIds)) : [],
    liabilityIds.length > 0 ? q.select().from(liabilityOwners).where(inArray(liabilityOwners.liabilityId, liabilityIds)) : [],
  ]);
  const bequestIds = bequests.map((b) => b.id);
  const grantIds = grants.map((g) => g.id);
  const [bequestRecipients, tranches] = await Promise.all([
    bequestIds.length > 0
      ? q.select().from(willBequestRecipients).where(inArray(willBequestRecipients.bequestId, bequestIds)).orderBy(asc(willBequestRecipients.sortOrder))
      : [],
    grantIds.length > 0
      ? q
          .select()
          .from(stockOptionVestTranches)
          .where(inArray(stockOptionVestTranches.grantId, grantIds))
          .orderBy(asc(stockOptionVestTranches.sortOrder), asc(stockOptionVestTranches.vestDate))
      : [],
  ]);

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
  /** A will recipient. "spouse" is the grantor's spouse — the other household principal. */
  const recipient = (kind: string, id: string | null, grantor: Role): RecordRef =>
    kind === "spouse"
      ? person(grantor === "client" ? "spouse" : "client")
      : kind === "family_member"
        ? member(String(id))
        : record(kind === "entity" ? "entity" : "external_beneficiary", String(id));
  /** The family member, trust or charity a row names — an owner, a designee, a gift's recipient; null for none. */
  const whoOf = (familyMemberId: string | null, entityId: string | null, externalId: string | null | undefined): RecordRef | null =>
    familyMemberId ? member(familyMemberId) : entityId ? record("entity", entityId) : externalId ? record("external_beneficiary", externalId) : null;
  const beneficiariesOf = (rows: Designation[]) =>
    rows.flatMap((d) => {
      const who = d.householdRole ? person(d.householdRole) : whoOf(d.familyMemberId, d.entityIdRef, d.externalBeneficiaryId);
      return who ? [{ tier: d.tier, who, percentage: Number(d.percentage) }] : [];
    });
  /** Owners as the maps write them: { who, percent } with percent a fraction. Each owner row names exactly one (a check constraint). */
  const ownersOf = (rows: OwnerRow[]) =>
    rows
      .flatMap((o) => {
        const who = whoOf(o.familyMemberId, o.entityId, o.externalBeneficiaryId);
        return who ? [{ who, percent: Number(o.percent) }] : [];
      })
      .sort((a, b) => householdRank(a.who) - householdRank(b.who));
  /** Each account's owner rows. */
  const ownerRowsByAccount = new Map<string, OwnerRow[]>();
  for (const o of accountOwnerRows) {
    const rows = ownerRowsByAccount.get(o.accountId);
    if (rows) rows.push(o);
    else ownerRowsByAccount.set(o.accountId, [o]);
  }
  const ownersOfAccount = (a: Account) => ownerRowsByAccount.get(a.id) ?? [];
  /** A policy's owner as the policy dialog reads it: "joint", or its one owner; null for any other split. */
  const policyOwner = (rows: OwnerRow[]): PlacedValue => {
    const ref = ownerRefFromOwners(rows.map(engineOwner), { clientFmId: people.client, spouseFmId: people.spouse });
    if (!ref) return null;
    if (ref.kind === "joint") return "joint";
    return ref.kind === "family" ? member(ref.id) : record(ref.kind === "entity" ? "entity" : "external_beneficiary", ref.id);
  };
  const accountsOf = (target: TargetKind) => accountRows.filter((a) => (ACCOUNT_TARGET[a.category] ?? "account") === target);
  const plainAccounts = accountsOf("account");
  const policyAccounts = accountsOf("life_insurance_policy");
  const accountFacts = (a: Account) => ({ category: a.category, subType: a.subType, parentAccountId: a.parentAccountId, isDefaultChecking: a.isDefaultChecking });
  const policyOf = (accountId: string) => policies.find((p) => p.accountId === accountId);
  /** An account as the fact finder's link picker shows it: its name and last 4. */
  const accountLabel = (a: Account) => withLast4(a.name, a.accountNumberLast4);
  const policyLabel = (a: Account) => withLast4(a.name, policyOf(a.id)?.policyNumberLast4 ?? null);

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
      values: { beneficiaries: beneficiariesOf(designations.filter((d) => d.entityId === t.id)) },
    })),
    revocable_trust: revocables.map((t) => ({ id: t.id, label: t.name, values: { name: t.name } })),
    will: willRows.map((w) => ({ id: w.id, label: willLabel(names[w.grantor], w.grantor), values: { grantor: w.grantor }, facts: { grantor: w.grantor } })),
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
      label: `${willLabel(names[w.grantor], w.grantor)} — remaining estate`,
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
        recipient: whoOf(g.recipientFamilyMemberId, g.recipientEntityId, g.recipientExternalBeneficiaryId),
        amount: num(g.amount),
        notes: g.notes,
      },
    })),
    plan_observation: notes.map((n) => ({ id: n.id, label: n.title ?? n.body, values: { topic: n.topic, body: n.body } })),

    // Every base-case account is in exactly one of account, business_account,
    // life_insurance_policy and stock_option_account — so every account a row can
    // link to is here. A business's "— Cash" account is an account (category cash).
    account: plainAccounts.map((a) => ({
      id: a.id,
      label: accountLabel(a),
      values: {
        name: a.name,
        value: Number(a.value),
        accountNumberLast4: a.accountNumberLast4,
        custodian: a.custodian,
        subType: a.subType,
        owners: ownersOf(ownersOfAccount(a)),
        titlingType: a.titlingType,
        holdings: holdingRows.filter((h) => h.accountId === a.id).map(holding),
        growthRate: customRate(a.growthRate, a.growthSource),
        basis: Number(a.basis),
        rothValue: Number(a.rothValue),
        inheritedOwnerBirthYear: a.inheritedOwnerBirthYear,
        inheritedDeathYear: a.inheritedDeathYear,
        priorYearEndValue: num(a.priorYearEndValue),
        // A 529's people: a family member, else the name on record.
        beneficiary: a.beneficiaryFamilyMemberId ? member(a.beneficiaryFamilyMemberId) : a.beneficiaryName,
        grantor: a.grantorFamilyMemberId ? member(a.grantorFamilyMemberId) : a.grantorName,
        propertyAddress: a.propertyAddress,
        annualPropertyTax: Number(a.annualPropertyTax),
      },
      facts: accountFacts(a),
    })),
    business_account: accountsOf("business_account").map((a) => ({
      id: a.id,
      label: accountLabel(a),
      values: {
        name: a.name,
        businessType: a.businessType,
        value: Number(a.value),
        basis: Number(a.basis),
        owners: ownersOf(ownersOfAccount(a)),
        businessTaxTreatment: a.businessTaxTreatment,
        distributionPolicyPercent: num(a.distributionPolicyPercent),
      },
      facts: accountFacts(a),
    })),
    // One set per account, empty when it names nobody — as for trusts.
    account_beneficiary_designation: plainAccounts.map((a) => ({
      id: a.id,
      label: accountLabel(a),
      values: { beneficiaries: beneficiariesOf(accountDesignations.filter((d) => d.accountId === a.id)) },
    })),
    // One per annuity account (the contract is keyed by it), blank when none is on record.
    annuity_contract: plainAccounts
      .filter((a) => a.category === "annuity")
      .map((a) => {
        const c = contracts.find((x) => x.accountId === a.id);
        return {
          id: a.id,
          label: accountLabel(a),
          values: {
            costBasis: num(c?.costBasis ?? null),
            productType: c?.productType ?? null,
            incomeMode: c?.incomeMode ?? null,
            payoutStructure: c?.payoutStructure ?? null,
          },
        };
      }),
    stock_option_account: accountsOf("stock_option_account").map((a) => {
      // One owner at 100%: the client or the co-client.
      const owners = ownersOf(ownersOfAccount(a));
      const who = owners.length === 1 ? owners[0].who : null;
      return {
        id: a.id,
        label: a.name,
        values: {
          name: a.name,
          ticker: stockAccounts.find((s) => s.accountId === a.id)?.ticker ?? null,
          owner: who?.ref === "person" ? who.role : null,
        },
      };
    }),
    stock_option_grant: grants.map((g) => ({
      id: g.id,
      label: `${accountById.get(g.accountId)?.name ?? "Stock options"} ${g.grantType.toUpperCase()} ${g.grantDate}`,
      values: {
        grantType: g.grantType,
        grantNumber: g.grantNumber,
        grantDate: g.grantDate,
        sharesGranted: Number(g.sharesGranted),
        strikePrice: num(g.strikePrice),
        expirationDate: g.expirationDate,
        tranches: tranches.filter((t) => t.grantId === g.id).map((t) => ({ vestDate: t.vestDate, shares: Number(t.shares) })),
        notes: g.notes,
      },
      facts: { accountId: g.accountId },
    })),
    note_receivable: noteRows.map((n) => ({
      id: n.id,
      label: n.name,
      values: {
        name: n.name,
        faceValue: Number(n.faceValue),
        basis: Number(n.basis),
        asOfBalance: num(n.asOfBalance),
        balanceAsOf: monthYear(n.balanceAsOfYear, n.balanceAsOfMonth),
        interestRate: Number(n.interestRate),
        paymentType: n.paymentType,
        monthlyPayment: num(n.monthlyPayment),
        start: monthYear(n.startYear, n.startMonth),
        termMonths: n.termMonths,
        owners: ownersOf(noteOwnerRows.filter((o) => o.noteReceivableId === n.id)),
      },
    })),
    liability: liabilityRows.map((l) => ({
      id: l.id,
      label: l.name,
      values: {
        name: l.name,
        liabilityType: l.liabilityType,
        owners: ownersOf(liabilityOwnerRows.filter((o) => o.liabilityId === l.id)),
        balance: Number(l.balance),
        balanceAsOf: monthYear(l.balanceAsOfYear, l.balanceAsOfMonth),
        interestRate: Number(l.interestRate),
        monthlyPayment: num(l.monthlyPayment),
        start: monthYear(l.startYear, l.startMonth),
        termMonths: l.termMonths,
        isInterestDeductible: l.isInterestDeductible,
        linkedPropertyId: l.linkedPropertyId ? accountRef(l.linkedPropertyId) : null,
      },
      // Set = a business's debt, owned through the business (no owners of its own).
      facts: { parentAccountId: l.parentAccountId },
    })),
    life_insurance_policy: policyAccounts.map((a) => {
      const p = policyOf(a.id);
      return {
        id: a.id,
        label: policyLabel(a),
        values: {
          name: a.name,
          carrier: p?.carrier ?? null,
          policyNumberLast4: p?.policyNumberLast4 ?? null,
          policyType: p?.policyType ?? null,
          insuredPerson: a.insuredPerson,
          ownerRef: policyOwner(ownersOfAccount(a)),
          faceValue: num(p?.faceValue ?? null),
          cashValue: Number(a.value),
          costBasis: num(p?.costBasis ?? null),
          premiumAmount: num(p?.premiumAmount ?? null),
          premiumPayer: p?.premiumPayer ?? null,
          premiumYears: p?.premiumYears ?? null,
          termIssueYear: p?.termIssueYear ?? null,
          termLengthYears: p?.termLengthYears ?? null,
          endsAtInsuredRetirement: p?.endsAtInsuredRetirement ?? null,
        },
        facts: { insuredPerson: a.insuredPerson },
      };
    }),
    // One set per policy, empty when it names nobody.
    life_insurance_policy_beneficiary: policyAccounts.map((a) => ({
      id: a.id,
      label: policyLabel(a),
      values: { beneficiaries: beneficiariesOf(accountDesignations.filter((d) => d.accountId === a.id)) },
    })),
  };

  const book = emptyRecordBook(clientId);
  return { ...book, scenarioId, people, names, records: { ...book.records, ...records } };
}

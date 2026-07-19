// Shared married-household DB fixture for the divorce workbench.
//
// Every divisible-objects / split-preview / commit DB test (Tasks 4, 5, 7,
// 9–12) builds its world through `createMarriedFixture` and tears it down with
// `destroyFixture`. It writes rows with direct `db.insert(...)` — mirroring the
// shapes `createClientForHousehold` produces — instead of going through the
// service layer, so tests own an exact, deterministic graph with no audit
// side-effects.
//
// All inserts run inside a single `db.transaction`. That matters: the
// account_owners / liability_owners sum-check constraint triggers are
// DEFERRABLE INITIALLY DEFERRED (migration 0055/0063), so a 50/50 split is only
// valid once BOTH owner rows are present at commit. Running the inserts in one
// transaction lets the deferred check see the completed 100% before it fires.
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  crmHouseholds,
  crmHouseholdContacts,
  clients,
  scenarios,
  familyMembers,
  accounts,
  accountOwners,
  entities,
  entityOwners,
  incomes,
  expenses,
  liabilities,
  liabilityOwners,
  beneficiaryDesignations,
} from "@/db/schema";
import type { FilingStatus } from "@/lib/clients/create-client";

// The Cooper test firm — same org id the accounts/liabilities write-core tests
// use against the dev Neon branch.
export const TEST_FIRM_ID = "org_3CitTEIe8PJa1BVYw7LnEjkiP9r";
export const TEST_ADVISOR_ID = "user_test_divorce_fixture";

export interface MarriedFixture {
  firmId: string;
  householdId: string;
  clientId: string;
  baseScenarioId: string;
  primaryFmId: string;
  spouseFmId: string;
  childFmId: string;
  ids: {
    primaryBrokerage: string; // taxable, 100% primary, value 100k basis 60k
    jointBrokerage: string; // taxable, 50/50 primary+spouse, value 600k basis 200k
    spouse401k: string; // retirement, 100% spouse, value 400k rothValue 50k
    house: string; // real_estate, 50/50, value 800k basis 500k
    plan529: string; // education_savings, grantor primary, beneficiary child, value 50k
    trust: string; // entity: irrevocable trust, grantor client, isGrantor true
    trustAccount: string; // taxable owned 100% by trust (entityOwnedById)
    primarySalary: string; // income owner client 150k
    spouseSalary: string; // income owner spouse 120k
    livingExpense: string; // expense living 90k (no person owner)
    jointMortgage: string; // liability 50/50 via liability_owners, 300k, linkedPropertyId = house
    spouseBeneDesignation: string; // designation on spouse401k, familyMemberId = primaryFmId (names the other side)
  };
}

export interface CreateMarriedFixtureOverrides {
  // Filing status stamped on the clients row. Defaults to "married_joint"
  // (or "single" when noSpouse is set).
  filingStatus?: FilingStatus;
  // When true, no spouse contact / spouse family_member / spouse-owned objects
  // are created — a valid single-filer client. The spouse-dependent ids come
  // back as "" (Task 5's not_married guard only reads clientId).
  noSpouse?: boolean;
}

const EMPTY_IDS: MarriedFixture["ids"] = {
  primaryBrokerage: "",
  jointBrokerage: "",
  spouse401k: "",
  house: "",
  plan529: "",
  trust: "",
  trustAccount: "",
  primarySalary: "",
  spouseSalary: "",
  livingExpense: "",
  jointMortgage: "",
  spouseBeneDesignation: "",
};

export async function createMarriedFixture(
  overrides: CreateMarriedFixtureOverrides = {},
): Promise<MarriedFixture> {
  const noSpouse = overrides.noSpouse ?? false;
  const filingStatus: FilingStatus =
    overrides.filingStatus ?? (noSpouse ? "single" : "married_joint");
  const currentYear = new Date().getFullYear();
  const endYear = currentYear + 30;
  const suffix = randomUUID().slice(0, 8);

  return db.transaction(async (tx) => {
    // ── CRM household + contacts (mirrors what the CRM layer produces) ──
    const [hh] = await tx
      .insert(crmHouseholds)
      .values({
        firmId: TEST_FIRM_ID,
        advisorId: TEST_ADVISOR_ID,
        name: `Divorce Test HH ${suffix}`,
        status: "active",
        state: "CA",
      })
      .returning({ id: crmHouseholds.id });

    await tx.insert(crmHouseholdContacts).values({
      householdId: hh.id,
      role: "primary",
      firstName: "Taylor",
      lastName: "Primary",
      dateOfBirth: "1975-06-15",
    });
    if (!noSpouse) {
      await tx.insert(crmHouseholdContacts).values({
        householdId: hh.id,
        role: "spouse",
        firstName: "Jordan",
        lastName: "Spouse",
        dateOfBirth: "1977-03-22",
      });
    }

    // ── Client + Base Case scenario ──
    const [client] = await tx
      .insert(clients)
      .values({
        firmId: TEST_FIRM_ID,
        advisorId: TEST_ADVISOR_ID,
        crmHouseholdId: hh.id,
        retirementAge: 65,
        retirementMonth: 1,
        planEndAge: 90,
        lifeExpectancy: 90,
        filingStatus,
        spouseRetirementAge: noSpouse ? null : 65,
        spouseRetirementMonth: noSpouse ? null : 1,
        spouseLifeExpectancy: noSpouse ? null : 92,
      })
      .returning({ id: clients.id });

    const [scenario] = await tx
      .insert(scenarios)
      .values({ clientId: client.id, name: "Base Case", isBaseCase: true })
      .returning({ id: scenarios.id });

    // ── Family members. role drives side mapping; client→primary, spouse→spouse.
    // The child is a non-principal member and surfaces as a family_member object.
    const [primaryFm] = await tx
      .insert(familyMembers)
      .values({
        clientId: client.id,
        role: "client",
        relationship: "other",
        firstName: "Taylor",
        lastName: "Primary",
        dateOfBirth: "1975-06-15",
      })
      .returning({ id: familyMembers.id });

    let spouseFmId = "";
    if (!noSpouse) {
      const [spouseFm] = await tx
        .insert(familyMembers)
        .values({
          clientId: client.id,
          role: "spouse",
          relationship: "other",
          firstName: "Jordan",
          lastName: "Spouse",
          dateOfBirth: "1977-03-22",
        })
        .returning({ id: familyMembers.id });
      spouseFmId = spouseFm.id;
    }

    const [childFm] = await tx
      .insert(familyMembers)
      .values({
        clientId: client.id,
        role: "child",
        relationship: "child",
        firstName: "Casey",
        lastName: "Primary",
        dateOfBirth: "2012-09-01",
      })
      .returning({ id: familyMembers.id });

    const acctBase = { clientId: client.id, scenarioId: scenario.id };

    // ── primaryBrokerage: taxable, 100% primary, value 100k basis 60k ──
    const [primaryBrokerage] = await tx
      .insert(accounts)
      .values({
        ...acctBase,
        name: "Primary Brokerage",
        category: "taxable",
        subType: "brokerage",
        value: "100000.00",
        basis: "60000.00",
      })
      .returning({ id: accounts.id });
    await tx.insert(accountOwners).values({
      accountId: primaryBrokerage.id,
      familyMemberId: primaryFm.id,
      percent: "1.0000",
    });

    // ── primarySalary: income owner client 150k ──
    const [primarySalary] = await tx
      .insert(incomes)
      .values({
        ...acctBase,
        type: "salary",
        name: "Primary Salary",
        annualAmount: "150000.00",
        startYear: currentYear,
        endYear,
        owner: "client",
      })
      .returning({ id: incomes.id });

    // ── livingExpense: expense living 90k, no person/entity/account owner ──
    const [livingExpense] = await tx
      .insert(expenses)
      .values({
        ...acctBase,
        type: "living",
        name: "Living Expenses",
        annualAmount: "90000.00",
        startYear: currentYear,
        endYear,
      })
      .returning({ id: expenses.id });

    if (noSpouse) {
      return {
        firmId: TEST_FIRM_ID,
        householdId: hh.id,
        clientId: client.id,
        baseScenarioId: scenario.id,
        primaryFmId: primaryFm.id,
        spouseFmId: "",
        childFmId: childFm.id,
        ids: {
          ...EMPTY_IDS,
          primaryBrokerage: primaryBrokerage.id,
          primarySalary: primarySalary.id,
          livingExpense: livingExpense.id,
        },
      } satisfies MarriedFixture;
    }

    // ── jointBrokerage: taxable, 50/50 primary+spouse, value 600k basis 200k ──
    const [jointBrokerage] = await tx
      .insert(accounts)
      .values({
        ...acctBase,
        name: "Joint Brokerage",
        category: "taxable",
        subType: "brokerage",
        value: "600000.00",
        basis: "200000.00",
      })
      .returning({ id: accounts.id });
    await tx.insert(accountOwners).values([
      { accountId: jointBrokerage.id, familyMemberId: primaryFm.id, percent: "0.5000" },
      { accountId: jointBrokerage.id, familyMemberId: spouseFmId, percent: "0.5000" },
    ]);

    // ── spouse401k: retirement, 100% spouse, value 400k rothValue 50k.
    // Retirement single-owner constraint (0055) requires exactly one owner @100%.
    const [spouse401k] = await tx
      .insert(accounts)
      .values({
        ...acctBase,
        name: "Spouse 401(k)",
        category: "retirement",
        subType: "401k",
        value: "400000.00",
        basis: "0.00",
        rothValue: "50000.00",
        rmdEnabled: true,
      })
      .returning({ id: accounts.id });
    await tx.insert(accountOwners).values({
      accountId: spouse401k.id,
      familyMemberId: spouseFmId,
      percent: "1.0000",
    });

    // ── house: real_estate, 50/50 primary+spouse, value 800k basis 500k ──
    const [house] = await tx
      .insert(accounts)
      .values({
        ...acctBase,
        name: "Family Home",
        category: "real_estate",
        subType: "primary_residence",
        value: "800000.00",
        basis: "500000.00",
      })
      .returning({ id: accounts.id });
    await tx.insert(accountOwners).values([
      { accountId: house.id, familyMemberId: primaryFm.id, percent: "0.5000" },
      { accountId: house.id, familyMemberId: spouseFmId, percent: "0.5000" },
    ]);

    // ── plan529: education_savings, grantor primary, beneficiary child, value
    // 50k. No account_owners rows — side is derived from grantorFamilyMemberId.
    const [plan529] = await tx
      .insert(accounts)
      .values({
        ...acctBase,
        name: "Casey 529",
        category: "education_savings",
        subType: "529",
        value: "50000.00",
        basis: "40000.00",
        grantorFamilyMemberId: primaryFm.id,
        beneficiaryFamilyMemberId: childFm.id,
      })
      .returning({ id: accounts.id });

    // ── trust: irrevocable grantor trust, grantor client. Its side is derived
    // from an entity_owners fm row (primary) per the loader's entity rule.
    const [trust] = await tx
      .insert(entities)
      .values({
        clientId: client.id,
        name: "Family Irrevocable Trust",
        entityType: "trust",
        trustSubType: "irrevocable",
        isIrrevocable: true,
        isGrantor: true,
        grantor: "client",
        value: "0.00",
        basis: "0.00",
      })
      .returning({ id: entities.id });
    await tx.insert(entityOwners).values({
      entityId: trust.id,
      familyMemberId: primaryFm.id,
      percent: "1.0000",
    });

    // ── trustAccount: taxable owned 100% by the trust (account_owners.entityId).
    // Its value folds into the entity's value; it follows the trust in the pool.
    const [trustAccount] = await tx
      .insert(accounts)
      .values({
        ...acctBase,
        name: "Trust Brokerage",
        category: "taxable",
        subType: "brokerage",
        value: "300000.00",
        basis: "150000.00",
      })
      .returning({ id: accounts.id });
    await tx.insert(accountOwners).values({
      accountId: trustAccount.id,
      entityId: trust.id,
      percent: "1.0000",
    });

    // ── spouseSalary: income owner spouse 120k ──
    const [spouseSalary] = await tx
      .insert(incomes)
      .values({
        ...acctBase,
        type: "salary",
        name: "Spouse Salary",
        annualAmount: "120000.00",
        startYear: currentYear,
        endYear,
        owner: "spouse",
      })
      .returning({ id: incomes.id });

    // ── jointMortgage: liability 50/50 via liability_owners, 300k, secured by
    // the house (linkedPropertyId). ──
    const [jointMortgage] = await tx
      .insert(liabilities)
      .values({
        ...acctBase,
        name: "Home Mortgage",
        balance: "300000.00",
        interestRate: "0.0550",
        monthlyPayment: "1703.37",
        startYear: currentYear,
        startMonth: 1,
        termMonths: 360,
        liabilityType: "mortgage",
        linkedPropertyId: house.id,
        isInterestDeductible: true,
      })
      .returning({ id: liabilities.id });
    await tx.insert(liabilityOwners).values([
      { liabilityId: jointMortgage.id, familyMemberId: primaryFm.id, percent: "0.5000" },
      { liabilityId: jointMortgage.id, familyMemberId: spouseFmId, percent: "0.5000" },
    ]);

    // ── spouseBeneDesignation: primary beneficiary of the spouse's 401(k) is
    // the primary spouse (names the OTHER side) — a commit-blocker signal in
    // later tasks. ──
    const [spouseBeneDesignation] = await tx
      .insert(beneficiaryDesignations)
      .values({
        clientId: client.id,
        targetKind: "account",
        accountId: spouse401k.id,
        tier: "primary",
        familyMemberId: primaryFm.id,
        percentage: "100.00",
        sortOrder: 0,
      })
      .returning({ id: beneficiaryDesignations.id });

    return {
      firmId: TEST_FIRM_ID,
      householdId: hh.id,
      clientId: client.id,
      baseScenarioId: scenario.id,
      primaryFmId: primaryFm.id,
      spouseFmId,
      childFmId: childFm.id,
      ids: {
        primaryBrokerage: primaryBrokerage.id,
        jointBrokerage: jointBrokerage.id,
        spouse401k: spouse401k.id,
        house: house.id,
        plan529: plan529.id,
        trust: trust.id,
        trustAccount: trustAccount.id,
        primarySalary: primarySalary.id,
        spouseSalary: spouseSalary.id,
        livingExpense: livingExpense.id,
        jointMortgage: jointMortgage.id,
        spouseBeneDesignation: spouseBeneDesignation.id,
      },
    } satisfies MarriedFixture;
  });
}

// Delete the clients row BEFORE the crm_households row: clients.crmHouseholdId
// is ON DELETE RESTRICT, so the household can't go first. Deleting the client
// cascades scenarios / family_members / accounts / account_owners / entities /
// entity_owners / incomes / expenses / liabilities / liability_owners /
// beneficiary_designations; deleting the household cascades its CRM contacts.
export async function destroyFixture(f: MarriedFixture): Promise<void> {
  if (f.clientId) {
    await db.delete(clients).where(eq(clients.id, f.clientId));
  }
  if (f.householdId) {
    await db.delete(crmHouseholds).where(eq(crmHouseholds.id, f.householdId));
  }
}

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
  planSettings,
  familyMembers,
  accounts,
  accountOwners,
  accountHoldings,
  lifeInsurancePolicies,
  entities,
  entityOwners,
  trustSplitInterestDetails,
  externalBeneficiaries,
  incomes,
  expenses,
  liabilities,
  liabilityOwners,
  beneficiaryDesignations,
  transfers,
  gifts,
  clientImports,
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
  // A second scenario with is_base_case = false — populated only when the
  // `withNonBaseScenario` override is set (Task 7's non_base_scenarios blocker).
  // "" otherwise.
  nonBaseScenarioId: string;
  // A transfer whose endpoints land on opposite sides once jointBrokerage moves
  // to the spouse — populated only when `withStraddleTransfer` is set (Task 7's
  // straddle_dropped warning). "" otherwise.
  straddleTransferId: string;
  // A client_imports row with status 'review' — populated only when
  // `withActiveImport` is set (Task 7's import_in_flight blocker). "" otherwise.
  activeImportId: string;
  // A gift with grantor='spouse' and recipient the child — populated only when
  // `withSpouseGift` is set (Task 10's grantor-enum follow). "" otherwise.
  spouseGiftId: string;
  // A holdings-backed splittable taxable account (deriveFromHoldings on, ≥1
  // account_holdings row) — populated only when `withHoldingsAccount` is set
  // (Task 11 Fix 1: split must stop holdings-driving). "" otherwise.
  holdingsAccountId: string;
  // A charitable-remainder trust (trustSubType='crt') with a
  // trust_split_interest_details row (single-life term, measuring life = the
  // child, charity remainder) + a trust-target remainder designation — populated
  // only when `withCharitableTrust` is set (Task 11 Fixes 2 & 4). "" otherwise.
  charitableTrustId: string;
  charityId: string;
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
    lifeInsurance: string; // life_insurance, 100% primary, value 25k — non-splittable (Task 5 AllocationError case)
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
  // Add a second, non-base scenario (populates `nonBaseScenarioId`).
  withNonBaseScenario?: boolean;
  // Add a transfer jointBrokerage → primaryBrokerage; straddles once
  // jointBrokerage is allocated to the spouse (populates `straddleTransferId`).
  withStraddleTransfer?: boolean;
  // Add a client_imports row with status 'review' (populates `activeImportId`).
  withActiveImport?: boolean;
  // Add a gift row with grantor='spouse', recipient = the child (populates
  // `spouseGiftId`). Exercises Task 10's grantor-enum follow.
  withSpouseGift?: boolean;
  // Add a holdings-backed splittable taxable account (populates
  // `holdingsAccountId`). Exercises Task 11 Fix 1 (split stops holdings-driving).
  withHoldingsAccount?: boolean;
  // Add a CRT + trust_split_interest_details + a charity + a remainder
  // designation (populates `charitableTrustId`/`charityId`). Exercises Task 11
  // Fixes 2 (measuring-life remap/throw) & 4 (move re-points split-interest).
  withCharitableTrust?: boolean;
  // Attach a life_insurance_policies extension to the trust's owned account
  // (`ids.trustAccount`). Exercises Task 11 Fix 3 (duplicate warns the 1:1
  // ride-along wasn't copied). Requires the married graph (no-op for noSpouse).
  withTrustLifePolicy?: boolean;
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
  lifeInsurance: "",
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

    // Plan settings — required for anything that loads the client's effective
    // tree (e.g. the commit engine's pre-divorce snapshot). Mirrors the row
    // createClientForHousehold seeds; the rest of plan_settings has defaults.
    await tx.insert(planSettings).values({
      clientId: client.id,
      scenarioId: scenario.id,
      planStartYear: currentYear,
      planEndYear: endYear,
      residenceState: "CA",
    });

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
        nonBaseScenarioId: "",
        straddleTransferId: "",
        activeImportId: "",
        spouseGiftId: "",
        holdingsAccountId: "",
        charitableTrustId: "",
        charityId: "",
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

    // ── lifeInsurance: life_insurance, 100% primary, value 25k. Not in
    // SPLITTABLE_ACCOUNT_CATEGORIES — used to exercise the "split not allowed"
    // AllocationError path in the Task 5 draft-service tests. ──
    const [lifeInsurance] = await tx
      .insert(accounts)
      .values({
        ...acctBase,
        name: "Primary Life Insurance",
        category: "life_insurance",
        subType: "other",
        value: "25000.00",
        basis: "0.00",
      })
      .returning({ id: accounts.id });
    await tx.insert(accountOwners).values({
      accountId: lifeInsurance.id,
      familyMemberId: primaryFm.id,
      percent: "1.0000",
    });

    // ── Optional overrides. Kept inside the fixture transaction so every test
    // owns one deterministic graph (see the file header). None carry deferred
    // constraints, so ordering relative to the rows above doesn't matter. ──
    let nonBaseScenarioId = "";
    if (overrides.withNonBaseScenario) {
      const [alt] = await tx
        .insert(scenarios)
        .values({ clientId: client.id, name: "What-If", isBaseCase: false })
        .returning({ id: scenarios.id });
      nonBaseScenarioId = alt.id;
    }

    let straddleTransferId = "";
    if (overrides.withStraddleTransfer) {
      const [xfer] = await tx
        .insert(transfers)
        .values({
          clientId: client.id,
          scenarioId: scenario.id,
          name: "Brokerage Sweep",
          sourceAccountId: jointBrokerage.id,
          targetAccountId: primaryBrokerage.id,
          amount: "10000.00",
          startYear: currentYear,
        })
        .returning({ id: transfers.id });
      straddleTransferId = xfer.id;
    }

    let spouseGiftId = "";
    if (overrides.withSpouseGift) {
      const [gift] = await tx
        .insert(gifts)
        .values({
          clientId: client.id,
          year: currentYear,
          grantor: "spouse",
          amount: "15000.00",
          recipientFamilyMemberId: childFm.id,
        })
        .returning({ id: gifts.id });
      spouseGiftId = gift.id;
    }

    let activeImportId = "";
    if (overrides.withActiveImport) {
      const [imp] = await tx
        .insert(clientImports)
        .values({
          clientId: client.id,
          orgId: TEST_FIRM_ID,
          mode: "updating",
          status: "review",
          createdByUserId: TEST_ADVISOR_ID,
        })
        .returning({ id: clientImports.id });
      activeImportId = imp.id;
    }

    // ── Holdings-backed splittable account (Fix 1). taxable, 100% primary,
    // value 100k basis 40k, deriveFromHoldings on (default) + one manual holding
    // whose marketValue matches — so the projection loader would derive value
    // from holdings until the split forces deriveFromHoldings off. ──
    let holdingsAccountId = "";
    if (overrides.withHoldingsAccount) {
      const [managed] = await tx
        .insert(accounts)
        .values({
          ...acctBase,
          name: "Managed Brokerage",
          category: "taxable",
          subType: "brokerage",
          value: "100000.00",
          basis: "40000.00",
        })
        .returning({ id: accounts.id });
      await tx.insert(accountOwners).values({
        accountId: managed.id,
        familyMemberId: primaryFm.id,
        percent: "1.0000",
      });
      await tx.insert(accountHoldings).values({
        accountId: managed.id,
        displayTicker: "VTI",
        displayName: "Total Market ETF",
        shares: "100.000000",
        price: "1000.0000",
        costBasis: "40000.00",
        marketValue: "100000.00",
        source: "manual",
      });
      holdingsAccountId = managed.id;
    }

    // ── Charitable-remainder trust with split-interest details (Fixes 2 & 4).
    // No entity_owners → side derives "joint" → default disposition "duplicate".
    // Single-life term measured on the CHILD (default duplicate → remaps to S);
    // charity remainder via external_beneficiaries + a remainder designation. ──
    let charitableTrustId = "";
    let charityId = "";
    if (overrides.withCharitableTrust) {
      const [crt] = await tx
        .insert(entities)
        .values({
          clientId: client.id,
          name: "Charitable Remainder Trust",
          entityType: "trust",
          trustSubType: "crt",
          isIrrevocable: true,
          isGrantor: true,
          grantor: "client",
          value: "0.00",
          basis: "0.00",
        })
        .returning({ id: entities.id });
      const [charity] = await tx
        .insert(externalBeneficiaries)
        .values({ clientId: client.id, name: "Test Charity", kind: "charity", charityType: "public" })
        .returning({ id: externalBeneficiaries.id });
      await tx.insert(trustSplitInterestDetails).values({
        entityId: crt.id,
        clientId: client.id,
        inceptionYear: currentYear,
        inceptionValue: "500000.00",
        payoutType: "annuity",
        payoutAmount: "25000.00",
        irc7520Rate: "0.0400",
        termType: "single_life",
        measuringLife1Id: childFm.id,
        charityId: charity.id,
        originalIncomeInterest: "300000.00",
        originalRemainderInterest: "200000.00",
      });
      await tx.insert(beneficiaryDesignations).values({
        clientId: client.id,
        targetKind: "trust",
        entityId: crt.id,
        tier: "remainder",
        externalBeneficiaryId: charity.id,
        percentage: "100.00",
        sortOrder: 0,
      });
      charitableTrustId = crt.id;
      charityId = charity.id;
    }

    // ── Life-insurance extension on the trust's owned account (Fix 3). The FK
    // has no category check, so a policy row on the taxable trust account is a
    // cheap way to exercise the "ride-along not copied" warning on duplicate. ──
    if (overrides.withTrustLifePolicy) {
      await tx.insert(lifeInsurancePolicies).values({
        accountId: trustAccount.id,
        policyType: "whole",
        faceValue: "500000.00",
      });
    }

    return {
      firmId: TEST_FIRM_ID,
      householdId: hh.id,
      clientId: client.id,
      baseScenarioId: scenario.id,
      primaryFmId: primaryFm.id,
      spouseFmId,
      childFmId: childFm.id,
      nonBaseScenarioId,
      straddleTransferId,
      activeImportId,
      spouseGiftId,
      holdingsAccountId,
      charitableTrustId,
      charityId,
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
        lifeInsurance: lifeInsurance.id,
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

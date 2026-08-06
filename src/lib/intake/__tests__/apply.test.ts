/**
 * DB integration test for applyIntake (existing-client path).
 *
 * Seeds a real client via createClientForHousehold (giving us a base-case
 * scenario, default "Retirement Living Expenses" row, family rows, etc.),
 * then inserts a `submitted` intake_forms row whose payload ADDS a 401k
 * account, a salary income, a child, stateOfResidence=NJ, and
 * annualRetirementExpenses=145000. applyIntake must write all of that into
 * the live tables on the base scenario, flip the form to `applied`, and be
 * idempotent on a second call.
 *
 * Note: Neon dev branch cold-starts after idle; run with --testTimeout=30000.
 */

import { describe, it, expect, afterAll, afterEach } from "vitest";
import { db } from "@/db";
import {
  accountOwners,
  crmActivity,
  crmHouseholds,
  crmHouseholdContacts,
  clients,
  accounts,
  incomes,
  expenses,
  familyMembers,
  intakeForms,
  liabilities,
  liabilityOwners,
  scenarios,
} from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { createClientForHousehold } from "@/lib/clients/create-client";
import { newIntakeToken, defaultExpiry } from "../tokens";
import type { IntakePayload } from "../schema";
import type { IntakeSectionKey } from "../sections";
import { applyIntake } from "../apply";

const FIRM = "test-firm-apply-intake-2026";
const ADVISOR = "user_test_apply";

async function householdName(householdId: string): Promise<string | null> {
  const [row] = await db
    .select({ name: crmHouseholds.name })
    .from(crmHouseholds)
    .where(eq(crmHouseholds.id, householdId));
  return row?.name ?? null;
}

// ── Shared fixture builders for the household-name-sync tests below ─────────
// Both scenarios (rename-the-primary, add-a-spouse) start from the identical
// seed: a household named "John Smith" with a single primary CRM contact and
// a matching planning client. Only the submitted payload differs per test.

/** Seeds a household ("John Smith", primary-only) + its planning client. */
async function seedJohnSmithHousehold(
  firmId: string,
  advisorId: string,
): Promise<{ householdId: string; clientId: string }> {
  const [hh] = await db
    .insert(crmHouseholds)
    .values({
      firmId,
      advisorId,
      name: "John Smith",
      status: "active",
      state: "TX",
    })
    .returning();
  const householdId = hh.id;

  await db.insert(crmHouseholdContacts).values({
    householdId,
    role: "primary",
    firstName: "John",
    lastName: "Smith",
    dateOfBirth: "1975-04-01",
    maritalStatus: "single",
  });

  const created = await createClientForHousehold({
    household: { id: householdId, firmId, advisorId, state: "TX" },
    primaryContact: {
      firstName: "John",
      lastName: "Smith",
      dateOfBirth: "1975-04-01",
    },
    retirementAge: 65,
    lifeExpectancy: 95,
    filingStatus: "single",
  });

  return { householdId, clientId: created.clientId };
}

/** Inserts a `submitted` intake form carrying only the given family section. */
async function submitForm(
  firmId: string,
  advisorId: string,
  clientId: string,
  family: IntakePayload["family"],
): Promise<string> {
  const payload: IntakePayload = {
    family,
    accounts: [],
    income: [],
    property: [],
    goals: { expenseGoals: [], topics: [] },
    meta: { completedSections: [] },
  };

  const token = newIntakeToken();
  const [form] = await db
    .insert(intakeForms)
    .values({
      firmId,
      clientId,
      mode: "blank",
      status: "submitted",
      token,
      recipientEmail: "john@example.com",
      recipientName: "John Smith",
      payload,
      createdByUserId: advisorId,
      submittedAt: new Date(),
      expiresAt: defaultExpiry(new Date()),
    })
    .returning();
  return form.id;
}

/** Inserts a `submitted` intake form with an explicit section set + payload. */
async function submitFormWithSections(
  firmId: string,
  advisorId: string,
  clientId: string,
  sections: IntakeSectionKey[] | null,
  payload: IntakePayload,
): Promise<string> {
  const [form] = await db
    .insert(intakeForms)
    .values({
      firmId,
      clientId,
      mode: "blank",
      status: "submitted",
      token: newIntakeToken(),
      recipientEmail: "john@example.com",
      recipientName: "John Smith",
      payload,
      sections,
      createdByUserId: advisorId,
      submittedAt: new Date(),
      expiresAt: defaultExpiry(new Date()),
    })
    .returning();
  return form.id;
}

/** Shared teardown for the household-name-sync tests (client cascade-deletes
 * scenarios/expenses, but we're explicit so cleanup doesn't rely on that). */
async function cleanup(ids: {
  formId?: string;
  clientId?: string;
  householdId?: string;
}): Promise<void> {
  const { formId, clientId, householdId } = ids;
  if (formId) await db.delete(intakeForms).where(eq(intakeForms.id, formId));
  if (clientId) {
    // accounts + liabilities before familyMembers: deleting a family member
    // cascades its account_owners / liability_owners rows, and the deferred
    // owner-sum triggers then raise on the still-present account or liability.
    // Dropping the owned rows first short-circuits both. (A liability is NOT
    // taken out by the account delete — linked_property_id is ON DELETE SET
    // NULL, so a mortgage outlives the property it was linked to.)
    await db.delete(liabilities).where(eq(liabilities.clientId, clientId));
    await db.delete(accounts).where(eq(accounts.clientId, clientId));
    await db.delete(familyMembers).where(eq(familyMembers.clientId, clientId));
    await db.delete(incomes).where(eq(incomes.clientId, clientId));
    await db.delete(expenses).where(eq(expenses.clientId, clientId));
    await db.delete(scenarios).where(eq(scenarios.clientId, clientId));
    await db.delete(clients).where(eq(clients.id, clientId));
  }
  if (householdId) {
    await db
      .delete(crmHouseholdContacts)
      .where(eq(crmHouseholdContacts.householdId, householdId));
    await db.delete(crmHouseholds).where(eq(crmHouseholds.id, householdId));
  }
}

describe("applyIntake (existing-client path)", () => {
  let householdId: string;
  let clientId: string;
  let scenarioId: string;
  let formId: string;

  afterAll(async () => {
    if (formId) await db.delete(intakeForms).where(eq(intakeForms.id, formId));
    if (clientId) {
      // liabilities + accounts first — see the note in cleanup() above.
      await db.delete(liabilities).where(eq(liabilities.clientId, clientId));
      await db.delete(accounts).where(eq(accounts.clientId, clientId));
      await db.delete(familyMembers).where(eq(familyMembers.clientId, clientId));
      await db.delete(incomes).where(eq(incomes.clientId, clientId));
      await db.delete(clients).where(eq(clients.id, clientId));
    }
    if (householdId) {
      await db
        .delete(crmHouseholdContacts)
        .where(eq(crmHouseholdContacts.householdId, householdId));
      await db.delete(crmHouseholds).where(eq(crmHouseholds.id, householdId));
    }
  });

  it("applies the staged payload to the existing client (and is idempotent)", async () => {
    // ── Seed household + primary contact ──────────────────────────────────
    const [hh] = await db
      .insert(crmHouseholds)
      .values({
        firmId: FIRM,
        advisorId: ADVISOR,
        name: "Apply Test HH",
        status: "active",
        state: "TX",
      })
      .returning();
    householdId = hh.id;

    await db.insert(crmHouseholdContacts).values({
      householdId,
      role: "primary",
      firstName: "Pat",
      lastName: "Prospect",
      dateOfBirth: "1975-04-01",
      maritalStatus: "single",
    });

    // ── Seed the planning client (base scenario + default expenses) ───────
    const created = await createClientForHousehold({
      household: { id: householdId, firmId: FIRM, advisorId: ADVISOR, state: "TX" },
      primaryContact: {
        firstName: "Pat",
        lastName: "Prospect",
        dateOfBirth: "1975-04-01",
      },
      retirementAge: 65,
      lifeExpectancy: 95,
      filingStatus: "single",
    });
    clientId = created.clientId;
    scenarioId = created.scenarioId;

    // ── Insert a `submitted` intake form that ADDS data ───────────────────
    const payload: IntakePayload = {
      family: {
        primary: {
          firstName: "Pat",
          lastName: "Prospect",
          dateOfBirth: "1975-04-01",
          maritalStatus: "married",
        },
        spouse: undefined,
        stateOfResidence: "NJ",
        children: [
          { firstName: "Kid", lastName: "Prospect", dateOfBirth: "2010-08-08" },
        ],
      },
      accounts: [
        { name: "Pat 401k", category: "retirement", value: 425000, owner: "client" },
      ],
      income: [
        {
          name: "Pat Salary",
          type: "salary",
          annualAmount: 180000,
          owner: "client",
          startYear: 2026,
          endYear: 2035,
          endsAtRetirement: false,
        },
        {
          name: "Pat Consulting",
          type: "business",
          annualAmount: 40000,
          owner: "client",
          startYear: 2027,
          endsAtRetirement: true,
        },
      ],
      property: [
        {
          name: "Pat Home",
          kind: "real_estate",
          value: 850000,
          basis: 500000,
          owner: "client",
          annualPropertyTax: 12000,
          annualInsurance: 2400,
          mortgage: {
            balance: 420000,
            yearsRemaining: 22,
            interestRatePct: 6.5,
            monthlyPayment: 2650,
          },
        },
      ],
      goals: {
        clientRetirementAge: 67,
        annualRetirementExpenses: 145000,
        expenseGoals: [
          {
            name: "Kid's college",
            type: "education",
            amount: 40000,
            startYear: 2028,
            years: 4,
            // Structural ref — index 0 of family.children, which apply matches
            // back to the child row it inserts in that same order.
            forWhom: "child:0",
          },
          // No start year and nobody named: apply has to fill both in.
          { name: "Anniversary trip", type: "travel", amount: 25000, years: 1 },
        ],
        topics: ["charitable", "legacy"],
        topicsNote: "Thinking about a cabin.",
      },
      meta: { completedSections: [] },
    };

    const token = newIntakeToken();
    const [form] = await db
      .insert(intakeForms)
      .values({
        firmId: FIRM,
        clientId,
        mode: "blank",
        status: "submitted",
        token,
        recipientEmail: "pat@example.com",
        recipientName: "Pat Prospect",
        payload,
        createdByUserId: ADVISOR,
        submittedAt: new Date(),
        expiresAt: defaultExpiry(new Date()),
      })
      .returning();
    formId = form.id;

    // ── Apply ─────────────────────────────────────────────────────────────
    const result = await applyIntake({ formId, firmId: FIRM, actorId: ADVISOR });
    expect(result.clientId).toBe(clientId);

    // ── Assert: a retirement account exists on the base scenario ──────────
    const accountRows = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.clientId, clientId), eq(accounts.scenarioId, scenarioId)));
    const retirement = accountRows.find((a) => a.name === "Pat 401k");
    expect(retirement).toBeTruthy();
    expect(retirement?.category).toBe("retirement");
    expect(retirement?.value).toBe("425000.00");

    // ── Assert: a salary income exists ────────────────────────────────────
    const incomeRows = await db
      .select()
      .from(incomes)
      .where(and(eq(incomes.clientId, clientId), eq(incomes.scenarioId, scenarioId)));
    const salary = incomeRows.find((i) => i.name === "Pat Salary");
    expect(salary).toBeTruthy();
    expect(salary?.type).toBe("salary");
    expect(salary?.annualAmount).toBe("180000.00");
    // Fixed window: the years the form supplied, with no milestone anchor.
    expect(salary?.startYear).toBe(2026);
    expect(salary?.endYear).toBe(2035);
    expect(salary?.endYearRef).toBeNull();

    // ── Assert: "ends at retirement" lands as an anchored row ─────────────
    // Pat was born 1975 and the form sets clientRetirementAge 67, so retirement
    // is 2042 and the last year of this income is 2041. The ref is what makes
    // the row follow the retirement age if the advisor later moves it.
    const consulting = incomeRows.find((i) => i.name === "Pat Consulting");
    expect(consulting).toBeTruthy();
    expect(consulting?.startYear).toBe(2027);
    expect(consulting?.endYear).toBe(2041);
    expect(consulting?.endYearRef).toBe("client_retirement");

    // ── Assert: property lands as an account carrying basis + property tax ─
    const home = accountRows.find((a) => a.name === "Pat Home");
    expect(home).toBeTruthy();
    expect(home?.category).toBe("real_estate");
    expect(home?.value).toBe("850000.00");
    expect(home?.basis).toBe("500000.00");
    // The column the projection reads to synthesize the property-tax outflow.
    expect(home?.annualPropertyTax).toBe("12000.00");

    // ── Assert: the property is owned, not ownerless ──────────────────────
    const homeOwners = await db
      .select()
      .from(accountOwners)
      .where(eq(accountOwners.accountId, home!.id));
    expect(homeOwners).toHaveLength(1);
    expect(homeOwners[0].percent).toBe("1.0000");

    // ── Assert: insurance lands as its own expense row ────────────────────
    const expenseRows = await db
      .select()
      .from(expenses)
      .where(and(eq(expenses.clientId, clientId), eq(expenses.scenarioId, scenarioId)));
    const insurance = expenseRows.find((e) => e.name === "Insurance – Pat Home");
    expect(insurance).toBeTruthy();
    expect(insurance?.type).toBe("insurance");
    expect(insurance?.annualAmount).toBe("2400.00");
    expect(insurance?.endYearRef).toBe("plan_end");

    // ── Assert: the mortgage lands as a liability linked to the property ──
    // The form asks balance + years left; the row has to be anchored at today
    // so the schedule amortizes exactly that balance over exactly that term.
    const liabilityRows = await db
      .select()
      .from(liabilities)
      .where(and(eq(liabilities.clientId, clientId), eq(liabilities.scenarioId, scenarioId)));
    expect(liabilityRows).toHaveLength(1);
    const mortgage = liabilityRows[0];
    expect(mortgage.name).toBe("Mortgage – Pat Home");
    expect(mortgage.balance).toBe("420000.00");
    expect(mortgage.liabilityType).toBe("mortgage");
    expect(mortgage.linkedPropertyId).toBe(home!.id);
    // Percent in, decimal fraction out.
    expect(mortgage.interestRate).toBe("0.0650");
    expect(mortgage.monthlyPayment).toBe("2650.00");
    expect(mortgage.termMonths).toBe(264); // 22 years
    // Deductible by default — the advisor un-ticks it for a rental.
    expect(mortgage.isInterestDeductible).toBe(true);
    expect(mortgage.startYear).toBe(new Date().getFullYear());
    expect(mortgage.startMonth).toBe(new Date().getMonth() + 1);
    // Zero elapsed months → the schedule starts from the declared balance.
    expect(mortgage.balanceAsOfYear).toBe(mortgage.startYear);
    expect(mortgage.balanceAsOfMonth).toBe(mortgage.startMonth);

    const mortgageOwners = await db
      .select()
      .from(liabilityOwners)
      .where(eq(liabilityOwners.liabilityId, mortgage.id));
    expect(mortgageOwners).toHaveLength(1);

    // ── Assert: a child familyMember exists ───────────────────────────────
    const childRows = await db
      .select()
      .from(familyMembers)
      .where(and(eq(familyMembers.clientId, clientId), eq(familyMembers.role, "child")));
    expect(childRows).toHaveLength(1);
    expect(childRows[0].firstName).toBe("Kid");

    // ── Assert: a funded goal lands as a goal-flagged education expense ───
    // Education is the one form type that maps across to a DB type; the rest
    // land as "other". `isGoal` is what puts it on the Household Map's Goals
    // board, and `inflationStartYear` is what makes the amount today's dollars —
    // without it the $40,000 would be read as the 2028 price.
    const college = expenseRows.find((e) => e.name === "Kid's college");
    expect(college).toBeTruthy();
    expect(college?.type).toBe("education");
    expect(college?.isGoal).toBe(true);
    expect(college?.annualAmount).toBe("40000.00");
    expect(college?.startYear).toBe(2028);
    // Both ends inclusive → four funded years is 2028–2031, not 2028–2032.
    expect(college?.endYear).toBe(2031);
    expect(college?.growthSource).toBe("inflation");
    expect(college?.inflationStartYear).toBe(new Date().getFullYear());
    // "Who is this for" is a NAME on the form; apply resolves it to the child
    // row it inserted moments earlier.
    expect(college?.forFamilyMemberId).toBe(childRows[0].id);

    // ── Assert: a non-education goal lands as a flagged "other" expense ───
    const trip = expenseRows.find((e) => e.name === "Anniversary trip");
    expect(trip).toBeTruthy();
    expect(trip?.type).toBe("other");
    expect(trip?.isGoal).toBe(true);
    // No start year given → this year; one year → start and end coincide.
    expect(trip?.startYear).toBe(new Date().getFullYear());
    expect(trip?.endYear).toBe(new Date().getFullYear());
    expect(trip?.forFamilyMemberId).toBeNull();

    // ── Assert: "On your radar" lands as a CRM note, not as expenses ──────
    // A checked box has no amount and no date, so it must NOT become a
    // projected row; the household timeline is where it belongs.
    const notes = await db
      .select()
      .from(crmActivity)
      .where(and(eq(crmActivity.householdId, householdId), eq(crmActivity.kind, "note")));
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBe("Goals to discuss (from intake)");
    expect(notes[0].body).toContain("Charitable giving");
    expect(notes[0].body).toContain("Leaving an inheritance");
    expect(notes[0].body).toContain("Thinking about a cabin.");
    // Only the two boxes that were checked.
    expect(notes[0].body).not.toContain("Paying off debt");

    // ── Assert: crmHouseholds.state === "NJ" ──────────────────────────────
    const [hhAfter] = await db
      .select()
      .from(crmHouseholds)
      .where(eq(crmHouseholds.id, householdId));
    expect(hhAfter.state).toBe("NJ");
    // The seed name ("Apply Test HH") doesn't match the primary contact
    // ("Pat Prospect") — applySectionsToClient's sync call re-derives it.
    expect(hhAfter.name).toBe("Pat Prospect");

    // ── Assert: the default "Retirement Living Expenses" row updated ──────
    const retExpense = expenseRows.find(
      (e) => e.name === "Retirement Living Expenses",
    );
    expect(retExpense).toBeTruthy();
    expect(retExpense?.annualAmount).toBe("145000.00");

    // ── Assert: clients.retirementAge updated ─────────────────────────────
    const [clientAfter] = await db
      .select()
      .from(clients)
      .where(eq(clients.id, clientId));
    expect(clientAfter.retirementAge).toBe(67);
    expect(clientAfter.filingStatus).toBe("married_joint");

    // ── Assert: form is applied with appliedAt set ────────────────────────
    const [formAfter] = await db
      .select()
      .from(intakeForms)
      .where(eq(intakeForms.id, formId));
    expect(formAfter.status).toBe("applied");
    expect(formAfter.appliedAt).toBeTruthy();

    // ── Idempotency: re-apply is a no-op, no double-insert ────────────────
    const result2 = await applyIntake({ formId, firmId: FIRM, actorId: ADVISOR });
    expect(result2.clientId).toBe(clientId);

    const accountRows2 = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.clientId, clientId), eq(accounts.scenarioId, scenarioId)));
    expect(accountRows2.filter((a) => a.name === "Pat 401k")).toHaveLength(1);

    const incomeRows2 = await db
      .select()
      .from(incomes)
      .where(and(eq(incomes.clientId, clientId), eq(incomes.scenarioId, scenarioId)));
    expect(incomeRows2.filter((i) => i.name === "Pat Salary")).toHaveLength(1);

    const childRows2 = await db
      .select()
      .from(familyMembers)
      .where(and(eq(familyMembers.clientId, clientId), eq(familyMembers.role, "child")));
    expect(childRows2).toHaveLength(1);

    // Goals fan out to two different tables, so both need the no-op check: a
    // duplicated goal row would double a projected cost, and a duplicated note
    // would clutter the timeline on every re-apply.
    const expenseRows2 = await db
      .select()
      .from(expenses)
      .where(and(eq(expenses.clientId, clientId), eq(expenses.scenarioId, scenarioId)));
    expect(expenseRows2.filter((e) => e.name === "Kid's college")).toHaveLength(1);

    const notes2 = await db
      .select()
      .from(crmActivity)
      .where(and(eq(crmActivity.householdId, householdId), eq(crmActivity.kind, "note")));
    expect(notes2).toHaveLength(1);
  });
});

const PFIRM = "test-firm-apply-intake-prospect-2026";
const PADVISOR = "user_test_apply_prospect";

describe("applyIntake (prospect path — creates client on approve)", () => {
  let householdId: string | undefined;
  let clientId: string | undefined;
  let scenarioId: string | undefined;
  let formId: string | undefined;

  afterAll(async () => {
    if (formId) await db.delete(intakeForms).where(eq(intakeForms.id, formId));
    if (clientId) {
      // liabilities + accounts first — see the note in cleanup() above.
      await db.delete(liabilities).where(eq(liabilities.clientId, clientId));
      await db.delete(accounts).where(eq(accounts.clientId, clientId));
      await db.delete(familyMembers).where(eq(familyMembers.clientId, clientId));
      await db.delete(incomes).where(eq(incomes.clientId, clientId));
      await db.delete(expenses).where(eq(expenses.clientId, clientId));
      await db.delete(scenarios).where(eq(scenarios.clientId, clientId));
      await db.delete(clients).where(eq(clients.id, clientId));
    }
    if (householdId) {
      await db
        .delete(crmHouseholdContacts)
        .where(eq(crmHouseholdContacts.householdId, householdId));
      await db.delete(crmHouseholds).where(eq(crmHouseholds.id, householdId));
    }
  });

  it("creates the household + client + base scenario, then applies the sections", async () => {
    // A `submitted` form with NO client yet — the prospect path must build the
    // whole tree from the staged payload.
    const payload: IntakePayload = {
      family: {
        primary: {
          firstName: "Robin",
          lastName: "Newclient",
          dateOfBirth: "1980-02-15",
          maritalStatus: "married",
        },
        spouse: {
          firstName: "Sam",
          lastName: "Newclient",
          dateOfBirth: "1982-06-20",
          maritalStatus: "married",
        },
        stateOfResidence: "CA",
        children: [
          { firstName: "Junior", lastName: "Newclient", dateOfBirth: "2012-03-03" },
        ],
      },
      accounts: [
        // Cast: this row deliberately omits `owner`, the way a payload staged
        // before the field existed does. Apply must still place it (on the
        // primary client) rather than throw.
        { name: "Robin 401k", category: "retirement", value: 310000 } as
          IntakePayload["accounts"][number],
        {
          name: "Joint Brokerage",
          category: "taxable",
          value: 500000,
          basis: 300000,
          owner: "joint",
        },
      ],
      income: [
        {
          name: "Robin Salary",
          type: "salary",
          annualAmount: 200000,
          owner: "client",
          endsAtRetirement: false,
        },
      ],
      property: [],
      goals: {
        clientRetirementAge: 66,
        spouseRetirementAge: 64,
        annualRetirementExpenses: 120000,
        expenseGoals: [],
        topics: [],
      },
      meta: { completedSections: [] },
    };

    const token = newIntakeToken();
    const [form] = await db
      .insert(intakeForms)
      .values({
        firmId: PFIRM,
        clientId: null,
        mode: "blank",
        status: "submitted",
        token,
        recipientEmail: "robin@example.com",
        recipientName: "Robin Newclient",
        payload,
        createdByUserId: PADVISOR,
        submittedAt: new Date(),
        expiresAt: defaultExpiry(new Date()),
      })
      .returning();
    formId = form.id;

    // ── Apply ─────────────────────────────────────────────────────────────
    const result = await applyIntake({ formId, firmId: PFIRM, actorId: PADVISOR });
    clientId = result.clientId;
    expect(clientId).toBeTruthy();

    // ── Assert: a NEW client row exists in the firm ───────────────────────
    const [clientRow] = await db
      .select()
      .from(clients)
      .where(eq(clients.id, clientId));
    expect(clientRow).toBeTruthy();
    expect(clientRow.firmId).toBe(PFIRM);
    expect(clientRow.retirementAge).toBe(66);
    expect(clientRow.spouseRetirementAge).toBe(64);
    expect(clientRow.filingStatus).toBe("married_joint");
    householdId = clientRow.crmHouseholdId;

    // ── Assert: a base-case scenario for the new client ───────────────────
    const baseScenarios = await db
      .select()
      .from(scenarios)
      .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)));
    expect(baseScenarios).toHaveLength(1);
    scenarioId = baseScenarios[0].id;

    // ── Assert: account applied to that scenario ──────────────────────────
    const accountRows = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.clientId, clientId), eq(accounts.scenarioId, scenarioId)));
    const retirement = accountRows.find((a) => a.name === "Robin 401k");
    expect(retirement).toBeTruthy();
    expect(retirement?.category).toBe("retirement");
    expect(retirement?.value).toBe("310000.00");

    // ── Assert: tax basis carried through (and defaults to 0) ─────────────
    const brokerage = accountRows.find((a) => a.name === "Joint Brokerage");
    expect(brokerage?.basis).toBe("300000.00");
    expect(retirement?.basis).toBe("0.00");

    // ── Assert: the owner enum became account_owners rows ─────────────────
    const fmRows = await db
      .select()
      .from(familyMembers)
      .where(eq(familyMembers.clientId, clientId));
    const clientFmId = fmRows.find((f) => f.role === "client")?.id;
    const spouseFmId = fmRows.find((f) => f.role === "spouse")?.id;

    const ownerRows = await db
      .select()
      .from(accountOwners)
      .where(inArray(accountOwners.accountId, [retirement!.id, brokerage!.id]));

    // joint taxable → 50/50 across both spouses
    const jointOwners = ownerRows.filter((o) => o.accountId === brokerage!.id);
    expect(jointOwners).toHaveLength(2);
    expect(jointOwners.every((o) => o.percent === "0.5000")).toBe(true);
    expect(new Set(jointOwners.map((o) => o.familyMemberId))).toEqual(
      new Set([clientFmId, spouseFmId]),
    );

    // owner omitted → the primary client at 100%
    const iraOwners = ownerRows.filter((o) => o.accountId === retirement!.id);
    expect(iraOwners).toHaveLength(1);
    expect(iraOwners[0].familyMemberId).toBe(clientFmId);
    expect(iraOwners[0].percent).toBe("1.0000");

    // ── Assert: salary income applied ─────────────────────────────────────
    const incomeRows = await db
      .select()
      .from(incomes)
      .where(and(eq(incomes.clientId, clientId), eq(incomes.scenarioId, scenarioId)));
    const salary = incomeRows.find((i) => i.name === "Robin Salary");
    expect(salary).toBeTruthy();
    expect(salary?.annualAmount).toBe("200000.00");

    // ── Assert: child applied ─────────────────────────────────────────────
    const childRows = await db
      .select()
      .from(familyMembers)
      .where(and(eq(familyMembers.clientId, clientId), eq(familyMembers.role, "child")));
    expect(childRows).toHaveLength(1);
    expect(childRows[0].firstName).toBe("Junior");

    // ── Assert: household created (state from payload) ────────────────────
    const [hhRow] = await db
      .select()
      .from(crmHouseholds)
      .where(eq(crmHouseholds.id, householdId));
    expect(hhRow).toBeTruthy();
    expect(hhRow.firmId).toBe(PFIRM);
    expect(hhRow.state).toBe("CA");
    // Named from both members, not the old `${lastName} Household` literal.
    // The insert derives this directly (see apply.ts), but the value asserted
    // here is guaranteed by applySectionsToClient's sync call against the
    // contact rows inserted above, in the same transaction — that's what
    // actually pins this behavior, not the insert alone.
    expect(hhRow.name).toBe("Robin & Sam Newclient");

    // ── Assert: primary AND spouse CRM contacts created ───────────────────
    const contactRows = await db
      .select()
      .from(crmHouseholdContacts)
      .where(eq(crmHouseholdContacts.householdId, householdId));
    const primaryContact = contactRows.find((c) => c.role === "primary");
    const spouseContact = contactRows.find((c) => c.role === "spouse");
    expect(primaryContact).toBeTruthy();
    expect(primaryContact?.firstName).toBe("Robin");
    expect(primaryContact?.email).toBe("robin@example.com");
    expect(spouseContact).toBeTruthy();
    expect(spouseContact?.firstName).toBe("Sam");

    // ── Assert: form now points to the new client and is applied ──────────
    const [formAfter] = await db
      .select()
      .from(intakeForms)
      .where(eq(intakeForms.id, formId));
    expect(formAfter.clientId).toBe(clientId);
    expect(formAfter.status).toBe("applied");
    expect(formAfter.appliedAt).toBeTruthy();
  });
});

const RFIRM = "test-firm-apply-intake-hh-rename-2026";
const RADVISOR = "user_test_apply_hh_rename";

describe("applyIntake (household name sync — merge path renames the primary)", () => {
  let householdId: string | undefined;
  let clientId: string | undefined;
  let formId: string | undefined;

  afterAll(() => cleanup({ formId, clientId, householdId }));

  it("re-derives the household name when intake renames the primary", async () => {
    ({ householdId, clientId } = await seedJohnSmithHousehold(RFIRM, RADVISOR));

    // Intake renames the primary from John to Jonathan.
    formId = await submitForm(RFIRM, RADVISOR, clientId, {
      primary: {
        firstName: "Jonathan",
        lastName: "Smith",
        dateOfBirth: "1975-04-01",
        maritalStatus: "single",
      },
      spouse: undefined,
      children: [],
    });

    await applyIntake({ formId, firmId: RFIRM, actorId: RADVISOR });

    expect(await householdName(householdId)).toBe("Jonathan Smith");
  });
});

const SFIRM = "test-firm-apply-intake-hh-add-spouse-2026";
const SADVISOR = "user_test_apply_hh_add_spouse";

describe("applyIntake (household name sync — merge path adds a spouse)", () => {
  let householdId: string | undefined;
  let clientId: string | undefined;
  let formId: string | undefined;

  afterAll(() => cleanup({ formId, clientId, householdId }));

  it("expands the household name when intake adds a spouse", async () => {
    ({ householdId, clientId } = await seedJohnSmithHousehold(SFIRM, SADVISOR));

    // Intake adds a spouse, Jane Smith, that wasn't there before.
    formId = await submitForm(SFIRM, SADVISOR, clientId, {
      primary: {
        firstName: "John",
        lastName: "Smith",
        dateOfBirth: "1975-04-01",
        maritalStatus: "married",
      },
      spouse: {
        firstName: "Jane",
        lastName: "Smith",
        dateOfBirth: "1976-09-12",
        maritalStatus: "married",
      },
      children: [],
    });

    await applyIntake({ formId, firmId: SFIRM, actorId: SADVISOR });

    expect(await householdName(householdId)).toBe("John & Jane Smith");
  });
});

describe("applyIntake — section gating", () => {
  const FIRM_S = "test-firm-apply-sections-2026";
  const ADVISOR_S = "user_test_apply_sections";
  let ids: { householdId?: string; clientId?: string; formId?: string } = {};

  afterEach(async () => {
    await cleanup(ids);
    ids = {};
  });

  it("does not write accounts when the form's sections exclude accounts", async () => {
    // A PREFILLED form seeded from a plan snapshot still carries account rows
    // the client never saw. Applying them would write stale snapshot data back
    // over the live plan.
    const { householdId, clientId } = await seedJohnSmithHousehold(FIRM_S, ADVISOR_S);
    const formId = await submitFormWithSections(FIRM_S, ADVISOR_S, clientId, ["family", "documents"], {
      family: {
        primary: { firstName: "John", lastName: "Smith", dateOfBirth: "1975-04-01" },
        children: [],
      },
      accounts: [
        { name: "Stale Brokerage", category: "taxable", value: 100_000, owner: "client" },
      ],
      income: [],
      property: [],
      goals: { expenseGoals: [], topics: [] },
      meta: { completedSections: [] },
    });
    ids = { householdId, clientId, formId };

    await applyIntake({ formId, firmId: FIRM_S, actorId: ADVISOR_S });

    const rows = await db.select({ name: accounts.name }).from(accounts).where(eq(accounts.clientId, clientId));
    expect(rows.map((r) => r.name)).not.toContain("Stale Brokerage");
  });

  it("applies a family-less form for an existing client without throwing", async () => {
    // No family payload at all — the DOB anchor has to come from the CRM
    // primary contact seeded above (1975-04-01), not from the payload.
    const { householdId, clientId } = await seedJohnSmithHousehold(FIRM_S, ADVISOR_S);
    const formId = await submitFormWithSections(FIRM_S, ADVISOR_S, clientId, ["documents"], {
      accounts: [],
      income: [],
      property: [],
      goals: { expenseGoals: [], topics: [] },
      meta: { completedSections: [] },
    });
    ids = { householdId, clientId, formId };

    await expect(
      applyIntake({ formId, firmId: FIRM_S, actorId: ADVISOR_S }),
    ).resolves.toEqual({ clientId });
  });
});

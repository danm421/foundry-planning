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

import { describe, it, expect, afterAll } from "vitest";
import { db } from "@/db";
import {
  crmHouseholds,
  crmHouseholdContacts,
  clients,
  accounts,
  incomes,
  expenses,
  familyMembers,
  intakeForms,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
// `scenarios` is not imported — the base scenario id comes back from
// createClientForHousehold; we assert against that directly.
import { createClientForHousehold } from "@/lib/clients/create-client";
import { newIntakeToken, defaultExpiry } from "../tokens";
import type { IntakePayload } from "../schema";
import { applyIntake } from "../apply";

const FIRM = "test-firm-apply-intake-2026";
const ADVISOR = "user_test_apply";

describe("applyIntake (existing-client path)", () => {
  let householdId: string;
  let clientId: string;
  let scenarioId: string;
  let formId: string;

  afterAll(async () => {
    if (formId) await db.delete(intakeForms).where(eq(intakeForms.id, formId));
    if (clientId) {
      await db.delete(familyMembers).where(eq(familyMembers.clientId, clientId));
      await db.delete(incomes).where(eq(incomes.clientId, clientId));
      await db.delete(accounts).where(eq(accounts.clientId, clientId));
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
        { name: "Pat 401k", category: "retirement", value: 425000 },
      ],
      income: [
        {
          name: "Pat Salary",
          type: "salary",
          annualAmount: 180000,
          owner: "client",
        },
      ],
      property: [],
      goals: {
        clientRetirementAge: 67,
        annualRetirementExpenses: 145000,
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

    // ── Assert: a child familyMember exists ───────────────────────────────
    const childRows = await db
      .select()
      .from(familyMembers)
      .where(and(eq(familyMembers.clientId, clientId), eq(familyMembers.role, "child")));
    expect(childRows).toHaveLength(1);
    expect(childRows[0].firstName).toBe("Kid");

    // ── Assert: crmHouseholds.state === "NJ" ──────────────────────────────
    const [hhAfter] = await db
      .select()
      .from(crmHouseholds)
      .where(eq(crmHouseholds.id, householdId));
    expect(hhAfter.state).toBe("NJ");

    // ── Assert: the default "Retirement Living Expenses" row updated ──────
    const expenseRows = await db
      .select()
      .from(expenses)
      .where(and(eq(expenses.clientId, clientId), eq(expenses.scenarioId, scenarioId)));
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
  });
});

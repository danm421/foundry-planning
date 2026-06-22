import { describe, it, expect, afterEach } from "vitest";
import { db } from "@/db";
import {
  clients,
  scenarios,
  planSettings,
  accounts,
  expenses,
  crmHouseholds,
  crmHouseholdContacts,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { createClientForHousehold } from "../create-client";

const FIRM = "test-firm-create-client-svc";

describe("createClientForHousehold", () => {
  const createdHouseholdIds: string[] = [];

  afterEach(async () => {
    // Deleting the household cascades nothing for clients (no FK back), so
    // delete clients first (cascades scenarios/planSettings/accounts/etc.),
    // then the household (cascades its contacts).
    for (const hhId of createdHouseholdIds) {
      await db.delete(clients).where(eq(clients.crmHouseholdId, hhId));
      await db.delete(crmHouseholds).where(eq(crmHouseholds.id, hhId));
    }
    createdHouseholdIds.length = 0;
  });

  async function seedHousehold(): Promise<{ id: string }> {
    const [hh] = await db
      .insert(crmHouseholds)
      .values({
        firmId: FIRM,
        advisorId: "advisor_svc",
        name: "Service Test HH",
        status: "active",
        state: "TX",
      })
      .returning();
    createdHouseholdIds.push(hh.id);
    await db.insert(crmHouseholdContacts).values({
      householdId: hh.id,
      role: "primary",
      firstName: "Pat",
      lastName: "Prospect",
      dateOfBirth: "1975-04-01",
    });
    return { id: hh.id };
  }

  it("creates a client with a base case scenario, plan settings, default expenses, and a default checking account", async () => {
    const hh = await seedHousehold();

    const result = await createClientForHousehold({
      household: { id: hh.id, firmId: FIRM, advisorId: "advisor_svc", state: "TX" },
      primaryContact: {
        firstName: "Pat",
        lastName: "Prospect",
        dateOfBirth: "1975-04-01",
      },
      retirementAge: 65,
      lifeExpectancy: 95,
      filingStatus: "single",
    });

    expect(result.clientId).toBeTruthy();
    expect(result.scenarioId).toBeTruthy();

    // clients row exists and carries the household's advisorId/firmId.
    const [clientRow] = await db
      .select()
      .from(clients)
      .where(eq(clients.id, result.clientId));
    expect(clientRow).toBeTruthy();
    expect(clientRow.firmId).toBe(FIRM);
    expect(clientRow.advisorId).toBe("advisor_svc");
    expect(clientRow.crmHouseholdId).toBe(hh.id);

    // Exactly one base-case scenario.
    const scenarioRows = await db
      .select()
      .from(scenarios)
      .where(eq(scenarios.clientId, result.clientId));
    const baseCases = scenarioRows.filter((s) => s.isBaseCase);
    expect(baseCases).toHaveLength(1);
    expect(baseCases[0].id).toBe(result.scenarioId);

    // Plan settings row exists, with residence state seeded from the household.
    const [ps] = await db
      .select()
      .from(planSettings)
      .where(eq(planSettings.clientId, result.clientId));
    expect(ps).toBeTruthy();
    expect(ps.residenceState).toBe("TX");

    // Two default living expenses, one named "Retirement Living Expenses".
    const expenseRows = await db
      .select()
      .from(expenses)
      .where(eq(expenses.clientId, result.clientId));
    const livingDefaults = expenseRows.filter(
      (e) => e.type === "living" && e.isDefault,
    );
    expect(livingDefaults).toHaveLength(2);
    const retirement = livingDefaults.find(
      (e) => e.name === "Retirement Living Expenses",
    );
    expect(retirement).toBeTruthy();
    expect(retirement?.isDefault).toBe(true);

    // Default "Household Cash" checking account.
    const [cash] = await db
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.clientId, result.clientId),
          eq(accounts.isDefaultChecking, true),
        ),
      );
    expect(cash).toBeTruthy();
    expect(cash.name).toBe("Household Cash");
    expect(cash.subType).toBe("checking");
  });
});

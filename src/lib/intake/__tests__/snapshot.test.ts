/**
 * DB integration test for snapshotClientToPayload.
 *
 * Seeds: household + contacts + client + base scenario + one account +
 * one income + one child family member.
 * Asserts the snapshot returns:
 *   - family.primary (from crmHouseholdContacts role=primary)
 *   - family.children (from familyMembers role=child)
 *   - accounts (category mapped to form subset)
 *   - income (type mapped to form subset)
 *   - goals.clientRetirementAge
 *
 * Note: Neon dev branch cold-starts after idle; run with --testTimeout=30000.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/db";
import {
  crmHouseholds,
  crmHouseholdContacts,
  clients,
  scenarios,
  planSettings,
  accounts,
  incomes,
  familyMembers,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import { snapshotClientToPayload } from "../snapshot";

const FIRM = "test-firm-snapshot-intake-2026";
const ADVISOR = "user_test_snapshot";

describe("snapshotClientToPayload", () => {
  let householdId: string;
  let clientId: string;
  let scenarioId: string;

  beforeAll(async () => {
    // 1. Create household
    const [hh] = await db
      .insert(crmHouseholds)
      .values({
        firmId: FIRM,
        advisorId: ADVISOR,
        name: "Snapshot Test HH",
        status: "active",
        state: "CA",
      })
      .returning();
    householdId = hh.id;

    // 2. Create primary contact
    await db.insert(crmHouseholdContacts).values({
      householdId,
      role: "primary",
      firstName: "Alice",
      lastName: "Tester",
      dateOfBirth: "1970-03-15",
      maritalStatus: "married",
    });

    // 3. Create client
    const [c] = await db
      .insert(clients)
      .values({
        firmId: FIRM,
        advisorId: ADVISOR,
        crmHouseholdId: householdId,
        retirementAge: 65,
        spouseRetirementAge: 63,
        planEndAge: 95,
        lifeExpectancy: 95,
        filingStatus: "married_joint",
      })
      .returning();
    clientId = c.id;

    // 4. Create base-case scenario
    const [sc] = await db
      .insert(scenarios)
      .values({
        clientId,
        name: "Base Case",
        isBaseCase: true,
      })
      .returning();
    scenarioId = sc.id;

    // planSettings is needed for a fully valid client but not for the snapshot query
    await db.insert(planSettings).values({
      clientId,
      scenarioId,
      planStartYear: 2026,
      planEndYear: 2065,
    });

    // 5. Seed a retirement account on the base scenario
    await db.insert(accounts).values({
      clientId,
      scenarioId,
      name: "401k Rollover",
      category: "retirement",
      value: "125000.00",
      basis: "0",
      custodian: "Fidelity",
      rmdEnabled: false,
    });

    // 6. Seed a salary income
    await db.insert(incomes).values({
      clientId,
      scenarioId,
      type: "salary",
      name: "Alice Salary",
      annualAmount: "150000.00",
      owner: "client",
      startYear: 2026,
      endYear: 2035,
    });

    // 7. Seed a child family member
    await db.insert(familyMembers).values({
      clientId,
      role: "child",
      relationship: "child",
      firstName: "Bobby",
      lastName: "Tester",
      dateOfBirth: "2005-06-01",
    });
  });

  afterAll(async () => {
    // Clean up in reverse FK order
    await db.delete(familyMembers).where(eq(familyMembers.clientId, clientId));
    await db.delete(incomes).where(eq(incomes.clientId, clientId));
    await db.delete(accounts).where(eq(accounts.clientId, clientId));
    await db.delete(planSettings).where(eq(planSettings.clientId, clientId));
    await db.delete(scenarios).where(eq(scenarios.clientId, clientId));
    await db.delete(clients).where(eq(clients.id, clientId));
    await db.delete(crmHouseholdContacts).where(
      eq(crmHouseholdContacts.householdId, householdId),
    );
    await db.delete(crmHouseholds).where(eq(crmHouseholds.id, householdId));
  });

  it("returns family.primary from the primary contact", async () => {
    const payload = await snapshotClientToPayload(clientId, FIRM);
    expect(payload.family.primary.firstName).toBe("Alice");
    expect(payload.family.primary.lastName).toBe("Tester");
    expect(payload.family.primary.dateOfBirth).toBe("1970-03-15");
    expect(payload.family.primary.maritalStatus).toBe("married");
  });

  it("returns stateOfResidence from the household", async () => {
    const payload = await snapshotClientToPayload(clientId, FIRM);
    expect(payload.family.stateOfResidence).toBe("CA");
  });

  it("returns children from familyMembers role=child", async () => {
    const payload = await snapshotClientToPayload(clientId, FIRM);
    expect(payload.family.children).toHaveLength(1);
    expect(payload.family.children[0].firstName).toBe("Bobby");
    expect(payload.family.children[0].lastName).toBe("Tester");
    expect(payload.family.children[0].dateOfBirth).toBe("2005-06-01");
  });

  it("returns mapped account with numeric value", async () => {
    const payload = await snapshotClientToPayload(clientId, FIRM);
    const acc = payload.accounts.find((a) => a.name === "401k Rollover");
    expect(acc).toBeDefined();
    expect(acc?.category).toBe("retirement");
    expect(acc?.value).toBe(125000);
    expect(acc?.custodian).toBe("Fidelity");
  });

  it("returns mapped income with correct type", async () => {
    const payload = await snapshotClientToPayload(clientId, FIRM);
    const inc = payload.income.find((i) => i.name === "Alice Salary");
    expect(inc).toBeDefined();
    expect(inc?.type).toBe("salary");
    expect(inc?.annualAmount).toBe(150000);
    expect(inc?.owner).toBe("client");
  });

  it("returns goals.clientRetirementAge from client row", async () => {
    const payload = await snapshotClientToPayload(clientId, FIRM);
    expect(payload.goals.clientRetirementAge).toBe(65);
    expect(payload.goals.spouseRetirementAge).toBe(63);
  });

  it("throws when the firmId does not match (org scoping)", async () => {
    await expect(
      snapshotClientToPayload(clientId, "other-firm"),
    ).rejects.toThrow();
  });

  it("drops stock_options and notes_receivable accounts (no form representation)", async () => {
    // Seed a stock_options account, assert it doesn't appear in accounts or property
    const [dropped] = await db
      .insert(accounts)
      .values({
        clientId,
        scenarioId,
        name: "RSU Grants",
        category: "stock_options",
        value: "50000.00",
        basis: "0",
        rmdEnabled: false,
      })
      .returning();

    try {
      const payload = await snapshotClientToPayload(clientId, FIRM);
      const allNames = [
        ...payload.accounts.map((a) => a.name),
        ...payload.property.map((p) => p.name),
      ];
      expect(allNames).not.toContain("RSU Grants");
    } finally {
      await db.delete(accounts).where(eq(accounts.id, dropped.id));
    }
  });

  it("maps real_estate accounts to property entries", async () => {
    const [reAccount] = await db
      .insert(accounts)
      .values({
        clientId,
        scenarioId,
        name: "Primary Home",
        category: "real_estate",
        value: "800000.00",
        basis: "200000.00",
        rmdEnabled: false,
      })
      .returning();

    try {
      const payload = await snapshotClientToPayload(clientId, FIRM);
      const prop = payload.property.find((p) => p.name === "Primary Home");
      expect(prop).toBeDefined();
      expect(prop?.kind).toBe("real_estate");
      expect(prop?.value).toBe(800000);
      // Must NOT appear in accounts
      expect(payload.accounts.map((a) => a.name)).not.toContain("Primary Home");
    } finally {
      await db.delete(accounts).where(eq(accounts.id, reAccount.id));
    }
  });
});

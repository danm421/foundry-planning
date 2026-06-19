// src/test/factories.ts
import { db } from "@/db";
import { clients, crmHouseholdContacts, crmHouseholds, scenarios } from "@/db/schema";

/**
 * Creates a minimal client + scenario for use in Orion DB integration tests.
 * The insert sequence satisfies the deferred contact constraint:
 *   1. crmHouseholds
 *   2. crmHouseholdContacts (satisfies primary-contact deferred check)
 *   3. clients (requires crmHouseholdId)
 *   4. scenarios
 */
export async function createTestClientWithScenario(
  firmId: string,
): Promise<{ clientId: string; scenarioId: string }> {
  const [household] = await db
    .insert(crmHouseholds)
    .values({ firmId, advisorId: "test_advisor", name: "Test Household" })
    .returning();

  await db.insert(crmHouseholdContacts).values({
    householdId: household.id,
    role: "primary",
    firstName: "Test",
    lastName: firmId,
    dateOfBirth: "1970-01-01",
  });

  const [client] = await db
    .insert(clients)
    .values({
      firmId,
      advisorId: "test_advisor",
      crmHouseholdId: household.id,
      retirementAge: 65,
      planEndAge: 90,
      lifeExpectancy: 90,
      filingStatus: "married_joint",
    })
    .returning();

  const [scenario] = await db
    .insert(scenarios)
    .values({ clientId: client.id, name: "base", isBaseCase: true })
    .returning();

  return { clientId: client.id, scenarioId: scenario.id };
}

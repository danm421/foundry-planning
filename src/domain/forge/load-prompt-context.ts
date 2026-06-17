import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { scenarios } from "@/db/schema";
import { getClientWithContacts } from "@/lib/clients/get-client-with-contacts";
import type { ForgePromptContext } from "./system-prompt";

/**
 * Assemble the variable system-prompt tail context for one forge turn:
 * firm name, client household title, and the active scenario's name/base flag.
 *
 * Lives outside the route (which mocks it in tests) and outside graph.ts (which
 * stays pure). `scenarioId === "base"` resolves the client's base-case row; any
 * other id is looked up scoped to the client so a foreign scenario id can't be
 * read across households.
 */
export async function loadPromptContext(args: {
  clientId: string;
  firmId: string;
  scenarioId: string;
  firmName: string;
}): Promise<ForgePromptContext> {
  const client = await getClientWithContacts(args.clientId, args.firmId);

  // ClientWithContacts has no householdTitle field — derive it from the primary
  // contact name (+ spouse first name), falling back to a neutral label when the
  // household has no name on file yet.
  const base = [client?.firstName, client?.lastName].filter(Boolean).join(" ");
  const householdTitle =
    (base ? base : "this client") +
    (client?.spouseFirstName ? ` & ${client.spouseFirstName}` : "");

  let scenario: { name: string; isBaseCase: boolean };
  if (args.scenarioId === "base") {
    const [row] = await db
      .select({ name: scenarios.name, isBaseCase: scenarios.isBaseCase })
      .from(scenarios)
      .where(and(eq(scenarios.clientId, args.clientId), eq(scenarios.isBaseCase, true)))
      .limit(1);
    scenario = row ?? { name: "Base Case", isBaseCase: true };
  } else {
    const [row] = await db
      .select({ name: scenarios.name, isBaseCase: scenarios.isBaseCase })
      .from(scenarios)
      .where(and(eq(scenarios.id, args.scenarioId), eq(scenarios.clientId, args.clientId)))
      .limit(1);
    scenario = row ?? { name: "Base Case", isBaseCase: true };
  }

  return { firmName: args.firmName, client: { householdTitle }, scenario };
}

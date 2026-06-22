import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { scenarios } from "@/db/schema";
import { getClientWithContacts } from "@/lib/clients/get-client-with-contacts";
import { getStore } from "./store";
import type { ForgePromptContext } from "./system-prompt";

/**
 * Recall durable, non-sensitive preferences from the long-term store for this
 * turn — client facts from the [firmId, clientId] namespace and the advisor's own
 * style prefs from [firmId, userId]. Each entry is scope-prefixed ("Client — …" /
 * "You — …") so the model knows whose preference it is.
 *
 * Best-effort: a store outage MUST NOT fail the chat turn, so the whole body is
 * wrapped in try/catch and falls open to `[]`. When `userId` is absent (the route
 * hasn't wired it yet) the advisor namespace is skipped and only client prefs load.
 */
async function loadKnownPreferences(
  firmId: string,
  clientId: string,
  userId?: string,
): Promise<string[]> {
  try {
    const store = getStore();
    const [clientItems, advisorItems] = await Promise.all([
      store.search([firmId, clientId], { limit: 25 }),
      userId ? store.search([firmId, userId], { limit: 25 }) : Promise.resolve([]),
    ]);
    const fmt = (label: string, items: Array<{ key: string; value: unknown }>) =>
      (items ?? []).map(
        (i) => `${label} — ${i.key}: ${(i.value as { value?: string })?.value ?? ""}`,
      );
    return [...fmt("Client", clientItems), ...fmt("You", advisorItems)]
      .filter((s) => s.trim().length > 0)
      .slice(0, 25);
  } catch {
    return []; // memory is best-effort; never dead-end a turn
  }
}

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
  /** Clerk user id of the advisor — gates the advisor-prefs namespace. Optional
   *  for back-compat; the route wires it in a later step. */
  userId?: string;
  /** Advisor display name, passed straight through to the prompt tail. */
  advisorName?: string;
  /** Today's date (YYYY-MM-DD), passed straight through to the prompt tail. */
  todayISO?: string;
}): Promise<ForgePromptContext> {
  const [client, knownPreferences] = await Promise.all([
    getClientWithContacts(args.clientId, args.firmId),
    loadKnownPreferences(args.firmId, args.clientId, args.userId),
  ]);

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

  return {
    firmName: args.firmName,
    client: { householdTitle },
    scenario,
    advisorName: args.advisorName,
    todayISO: args.todayISO,
    knownPreferences,
  };
}

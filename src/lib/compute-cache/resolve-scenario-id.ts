import { db } from "@/db";
import { scenarios } from "@/db/schema";
import { and, eq } from "drizzle-orm";

export async function resolveScenarioId(
  clientId: string,
  scenarioId: string | "base",
): Promise<string> {
  if (scenarioId !== "base") return scenarioId;
  const [base] = await db
    .select({ id: scenarios.id })
    .from(scenarios)
    .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)));
  if (!base) throw new Error(`No base scenario for client ${clientId}`);
  return base.id;
}

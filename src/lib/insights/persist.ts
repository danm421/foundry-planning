// src/lib/insights/persist.ts
import { db } from "@/db";
import { clientInsightProfiles } from "@/db/schema";
import type { ClientInsightProfileRow } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { GeneratedInsights } from "./generate";

export type InsightProfileRow = ClientInsightProfileRow;

export async function loadInsightProfile(clientId: string): Promise<InsightProfileRow | null> {
  const row = await db.query.clientInsightProfiles.findFirst({
    where: eq(clientInsightProfiles.clientId, clientId),
  });
  return row ?? null;
}

export async function saveInsightProfile(args: {
  clientId: string;
  sections: GeneratedInsights;
  inputHash: string;
  model: string;
  userId: string;
}): Promise<void> {
  const values = {
    clientId: args.clientId,
    snapshot: args.sections.snapshot,
    goals: args.sections.goals,
    // `opportunities` is deliberately absent: the model no longer emits it.
    // Because `values` doubles as the onConflictDoUpdate SET, omitting it
    // preserves an existing row's old text instead of blanking it.
    // Task 11 adds headline / actions / talkingPoints here.
    inputHash: args.inputHash,
    model: args.model,
    generatedByUserId: args.userId,
    updatedAt: new Date(),
  };
  await db
    .insert(clientInsightProfiles)
    .values(values)
    .onConflictDoUpdate({ target: clientInsightProfiles.clientId, set: values });
}

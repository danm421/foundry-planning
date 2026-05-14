import { eq } from "drizzle-orm";
import { db } from "@/db";
import { firms } from "@/db/schema";

/** Returns the firm's display name, falling back to "Foundry Planning". */
export async function getFirmDisplayName(firmId: string): Promise<string> {
  const row = await db
    .select({ displayName: firms.displayName })
    .from(firms)
    .where(eq(firms.firmId, firmId))
    .limit(1);
  return row[0]?.displayName?.trim() || "Foundry Planning";
}

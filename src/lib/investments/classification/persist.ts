// src/lib/investments/classification/persist.ts
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { securities, securityAssetClassWeights } from "@/db/schema";
import type { ClassifiedSecurity } from "./types";

/** Upsert a classified security and replace its weight rows. Idempotent. */
export async function upsertClassifiedSecurity(c: ClassifiedSecurity): Promise<string> {
  return await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(securities)
      .values({
        identifierType: c.identifierType,
        identifier: c.identifier,
        figi: c.figi,
        name: c.name,
        securityType: c.securityType,
        classifierSource: c.classifierSource,
        classifierVersion: c.classifierVersion,
        rawPayload: c.rawPayload ?? null,
      })
      .onConflictDoUpdate({
        target: [securities.identifierType, securities.identifier],
        set: {
          name: c.name,
          securityType: c.securityType,
          classifierSource: c.classifierSource,
          classifierVersion: c.classifierVersion,
          rawPayload: c.rawPayload ?? null,
          classifiedAt: new Date(),
          updatedAt: new Date(),
        },
      })
      .returning({ id: securities.id });

    const securityId = row.id;

    // Replace weight rows atomically — no reader can observe zero weights.
    await tx.delete(securityAssetClassWeights).where(eq(securityAssetClassWeights.securityId, securityId));
    if (c.weights.length > 0) {
      await tx.insert(securityAssetClassWeights).values(
        c.weights.map((w) => ({
          securityId,
          assetClassSlug: w.slug,
          weight: w.weight.toFixed(4),
        })),
      );
    }
    return securityId;
  });
}

/** Read a security + its weights by ticker, or null if not yet classified. */
export async function getSecurityByTicker(ticker: string) {
  const [sec] = await db
    .select()
    .from(securities)
    .where(and(eq(securities.identifierType, "ticker"), eq(securities.identifier, ticker.toUpperCase())))
    .limit(1);
  if (!sec) return null;
  const weights = await db
    .select()
    .from(securityAssetClassWeights)
    .where(eq(securityAssetClassWeights.securityId, sec.id));
  return { security: sec, weights };
}

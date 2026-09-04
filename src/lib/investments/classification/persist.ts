// src/lib/investments/classification/persist.ts
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { securities, securityAssetClassWeights } from "@/db/schema";
import type { ClassifiedSecurity } from "./types";
import { classifySecurity } from "./classify";

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
        expenseRatio: c.expenseRatio == null ? null : String(c.expenseRatio),
      })
      .onConflictDoUpdate({
        target: [securities.identifierType, securities.identifier],
        set: {
          name: c.name,
          securityType: c.securityType,
          classifierSource: c.classifierSource,
          classifierVersion: c.classifierVersion,
          rawPayload: c.rawPayload ?? null,
          expenseRatio: c.expenseRatio == null ? null : String(c.expenseRatio),
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

/**
 * A ticker's look-through slug weights, cache first: the securities table, then
 * a live classify + persist, then `[]`.
 *
 * Soft-fails per ticker on purpose — an unresolvable ticker becomes unclassified
 * weight for the caller to judge, and must not abort a whole portfolio's
 * resolution. Callers that need to know a ticker failed should compare the
 * returned weight against the holding's own.
 *
 * NB: `ticker-portfolio-compute.ts` and `rebalance/load-inputs.ts` still carry
 * their own copies of this sequence — see future-work/cma-investments.md.
 */
export async function resolveSlugWeightsByTicker(
  ticker: string,
): Promise<{ slug: string; weight: number }[]> {
  try {
    const cached = await getSecurityByTicker(ticker);
    if (cached) {
      return cached.weights.map((w) => ({
        slug: w.assetClassSlug,
        weight: parseFloat(w.weight),
      }));
    }
    const classified = await classifySecurity(ticker);
    if (!classified) return [];
    await upsertClassifiedSecurity(classified);
    const stored = await getSecurityByTicker(ticker);
    return stored
      ? stored.weights.map((w) => ({ slug: w.assetClassSlug, weight: parseFloat(w.weight) }))
      : [];
  } catch {
    return [];
  }
}

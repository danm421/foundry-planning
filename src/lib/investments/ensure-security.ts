// src/lib/investments/ensure-security.ts
import { getSecurityByTicker, upsertClassifiedSecurity } from "@/lib/investments/classification/persist";
import { classifySecurity } from "@/lib/investments/classification/classify";

/**
 * Resolve a ticker to a securities.id, classifying via EODHD on a cache miss so
 * the security has asset-class weights for the holdings rollup. Returns null
 * when there's no usable ticker or classification fails (the holding is then
 * stored unclassified — same as a manual position with no blend).
 */
export async function ensureSecurityForTicker(ticker: string | null): Promise<string | null> {
  const t = ticker?.trim().toUpperCase();
  if (!t) return null;
  const cached = await getSecurityByTicker(t);
  if (cached) return cached.security.id;
  const classified = await classifySecurity(t);
  if (!classified) return null;
  // upsertClassifiedSecurity returns the canonical securities.id from its
  // RETURNING clause — no need to re-fetch via getSecurityByTicker.
  return await upsertClassifiedSecurity(classified);
}

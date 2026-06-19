// src/lib/orion/reconcile.ts
import type { ExtractedAccount } from "@/lib/extraction/types";

export function reconcile(input: {
  mapped: ExtractedAccount[];
  existing: Array<{ id: string; externalId: string | null }>;
}): {
  exact: Array<{ account: ExtractedAccount; existingId: string }>;
  new: ExtractedAccount[];
} {
  const byExternal = new Map(input.existing.filter((e) => e.externalId).map((e) => [e.externalId!, e.id]));
  const exact: Array<{ account: ExtractedAccount; existingId: string }> = [];
  const fresh: ExtractedAccount[] = [];
  for (const account of input.mapped) {
    const existingId = account.externalId ? byExternal.get(account.externalId) : undefined;
    if (existingId) exact.push({ account, existingId });
    else fresh.push(account);
  }
  return { exact, new: fresh };
}

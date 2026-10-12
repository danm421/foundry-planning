// src/lib/imports/payload-json-sql.ts
import { sql, type SQL } from "drizzle-orm";
import { clientImports } from "@/db/schema";

/**
 * A `client_imports.payload_json` value that changes only the top-level keys
 * in `patch` (and removes the keys in `drop`), leaving every other slice as the
 * database has it at write time. Use it for any write that must not race a
 * concurrent writer of a different slice. Keys in `mergeInto` are merged
 * sub-key by sub-key into the stored object instead of replacing it, so entries
 * a concurrent writer stored under the same key survive.
 */
export function mergePayloadJson(
  patch: Record<string, unknown>,
  drop: readonly string[] = [],
  mergeInto: readonly string[] = [],
): SQL {
  let base: SQL = sql`COALESCE(${clientImports.payloadJson}, '{}'::jsonb)`;
  for (const key of drop) base = sql`(${base} - ${key}::text)`;
  const replaced = Object.fromEntries(Object.entries(patch).filter(([k]) => !mergeInto.includes(k)));
  let out: SQL = sql`${base} || ${JSON.stringify(replaced)}::jsonb`;
  for (const key of mergeInto) {
    out = sql`${out} || jsonb_build_object(${key}::text, COALESCE(${clientImports.payloadJson} -> ${key}::text, '{}'::jsonb) || ${JSON.stringify(patch[key] ?? {})}::jsonb)`;
  }
  return out;
}

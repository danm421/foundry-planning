// src/lib/imports/payload-json-sql.ts
import { sql, type SQL } from "drizzle-orm";
import { clientImports } from "@/db/schema";

/**
 * A `client_imports.payload_json` value that changes only the top-level keys
 * in `patch` (and removes the keys in `drop`), leaving every other slice as the
 * database has it at write time. Use it for any write that must not race a
 * concurrent writer of a different slice.
 */
export function mergePayloadJson(patch: Record<string, unknown>, drop: readonly string[] = []): SQL {
  let base: SQL = sql`COALESCE(${clientImports.payloadJson}, '{}'::jsonb)`;
  for (const key of drop) base = sql`(${base} - ${key}::text)`;
  return sql`${base} || ${JSON.stringify(patch)}::jsonb`;
}

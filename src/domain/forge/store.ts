// PostgresStore lives at the package's "/store" subpath (the root only exports
// PostgresSaver). Verified against @langchain/langgraph-checkpoint-postgres 1.0.2.
import { PostgresStore } from "@langchain/langgraph-checkpoint-postgres/store";

let cached: PostgresStore | null = null;

/**
 * Cached singleton long-term store over the POOLED runtime connection
 * (DATABASE_URL). Namespaces: [firmId, clientId] (client facts) and
 * [firmId, userId] (advisor prefs). setup() (DDL) is NOT called here — it runs
 * once via scripts/setup-forge-store.ts on the UNPOOLED connection, per DB
 * branch. Singleton because each store opens a pg pool; one per process,
 * mirroring getCheckpointer.
 */
export function getStore(): PostgresStore {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  cached = PostgresStore.fromConnString(url);
  return cached;
}

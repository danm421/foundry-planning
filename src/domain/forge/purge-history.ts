// src/domain/forge/purge-history.ts
import { sql, type SQL } from "drizzle-orm";
import type { db } from "@/db";
import { forgeConversations } from "@/db/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** LangGraph PostgresSaver's tables (chat history). A row's only link to a
 *  conversation is thread_id = forge_conversations.id. */
const CHECKPOINT_TABLES = ["checkpoints", "checkpoint_blobs", "checkpoint_writes"];
/** LangGraph PostgresStore's table (saved notes). namespace_path is the
 *  namespace labels joined with ':' (library 1.0.2): "<firmId>:<clientId>" for
 *  client notes, "<firmId>:<userId>" for advisor notes. */
const MEMORY_TABLE = "store";

/** Every LangGraph table Forge writes. None has a firm_id column, so the
 *  firm-purge drift guard checks this list instead. */
export const FORGE_LANGGRAPH_TABLES: readonly string[] = [...CHECKPOINT_TABLES, MEMORY_TABLE];

type ForgeHistoryScope =
  | { conversationId: string }
  | { clientId: string }
  | { firmId: string };

/**
 * Erase Forge's chat history and saved notes for a deleted conversation,
 * client or firm. They live in LangGraph's own tables, which no foreign key
 * reaches, so no cascade erases them.
 *
 *   - conversationId: that thread.
 *   - clientId: every conversation about the client, in any firm (a share
 *     recipient's too), and every firm's notes about it.
 *   - firmId: every conversation in the firm, and every note under the firm —
 *     its clients' and its advisors'.
 *
 * Run it in the transaction that deletes the Drizzle rows, BEFORE the
 * forge_conversations rows go (directly or by the client cascade): client and
 * firm scopes read the thread ids from them. Notes match on a whole namespace
 * label, so "org_ab" never reaches "org_abc". A database branch where Forge's
 * setup scripts never ran lacks these tables; each missing one is skipped so
 * the purge still succeeds there.
 */
export async function purgeForgeHistory(tx: Tx, scope: ForgeHistoryScope): Promise<void> {
  let threads: SQL;
  let notes: SQL | null;
  if ("conversationId" in scope) {
    threads = sql`${scope.conversationId}`;
    notes = null;
  } else if ("clientId" in scope) {
    threads = sql`select ${forgeConversations.id}::text from ${forgeConversations} where ${forgeConversations.clientId} = ${scope.clientId}`;
    notes = sql`split_part(namespace_path, ':', 2) = ${scope.clientId}`;
  } else {
    threads = sql`select ${forgeConversations.id}::text from ${forgeConversations} where ${forgeConversations.firmId} = ${scope.firmId}`;
    notes = sql`split_part(namespace_path, ':', 1) = ${scope.firmId}`;
  }

  const { rows } = await tx.execute<{ relname: string }>(sql`
    select relname from pg_class
    where relnamespace = 'public'::regnamespace and relname in ${FORGE_LANGGRAPH_TABLES}`);
  const present = new Set(rows.map((r) => r.relname));

  for (const table of CHECKPOINT_TABLES) {
    if (!present.has(table)) continue;
    await tx.execute(
      sql`delete from public.${sql.identifier(table)} where thread_id in (${threads})`,
    );
  }
  if (notes && present.has(MEMORY_TABLE)) {
    await tx.execute(sql`delete from public.${sql.identifier(MEMORY_TABLE)} where ${notes}`);
  }
}

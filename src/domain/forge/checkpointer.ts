import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

let cached: PostgresSaver | null = null;

/**
 * Cached singleton checkpointer over the POOLED runtime connection
 * (DATABASE_URL). thread_id is the copilot conversation id. setup() (DDL) is
 * NOT called here — it runs once via scripts/setup-copilot-checkpointer.ts on
 * the UNPOOLED connection. Singleton because each PostgresSaver opens a pg
 * pool; one per process, reused across requests.
 */
export function getCheckpointer(): PostgresSaver {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  cached = PostgresSaver.fromConnString(url);
  return cached;
}

// scripts/setup-forge-checkpointer.ts
// Run ONCE per environment to create the LangGraph checkpoint tables.
// Uses the UNPOOLED Neon connection because setup() issues DDL (pooled /
// PgBouncer transaction-mode connections reject some of it). Foundry's
// .env.local has only DATABASE_URL (pooled, host contains "-pooler"); we
// prefer an explicit DATABASE_URL_UNPOOLED, else strip "-pooler" from the
// pooled host (Neon's documented pooled↔direct host naming).
//
//   npx tsx scripts/setup-forge-checkpointer.ts
//
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env", override: false });

import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

function unpooledUrl(): string {
  const explicit = process.env.DATABASE_URL_UNPOOLED;
  if (explicit) return explicit;
  const pooled = process.env.DATABASE_URL;
  if (!pooled) {
    console.error("[setup-forge-checkpointer] No DATABASE_URL(_UNPOOLED) set.");
    process.exit(1);
  }
  // Neon: pooled host is "<endpoint>-pooler.<region>.aws.neon.tech";
  // the direct host drops "-pooler". No-op if "-pooler" isn't present.
  return pooled.replace("-pooler.", ".");
}

async function main() {
  const url = unpooledUrl();
  const saver = PostgresSaver.fromConnString(url);
  await saver.setup();
  console.log("[setup-forge-checkpointer] checkpoint tables ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[setup-forge-checkpointer] FAILED:", err);
  process.exit(1);
});

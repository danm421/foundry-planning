// scripts/setup-forge-store.ts
// Run ONCE per environment to create the LangGraph long-term store tables
// (forge cross-conversation memory). Mirrors setup-forge-checkpointer.ts: uses
// the UNPOOLED Neon connection because setup() issues DDL (pooled / PgBouncer
// transaction-mode connections reject some of it). Run on dev AND prod-v2 (live
// prod is the production-v2 Neon branch). A fresh branch without it throws 42P01
// at runtime.
//
//   npx tsx scripts/setup-forge-store.ts
//
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env", override: false });

import { PostgresStore } from "@langchain/langgraph-checkpoint-postgres/store";

function unpooledUrl(): string {
  const explicit = process.env.DATABASE_URL_UNPOOLED;
  if (explicit) return explicit;
  const pooled = process.env.DATABASE_URL;
  if (!pooled) {
    console.error("[setup-forge-store] No DATABASE_URL(_UNPOOLED) set.");
    process.exit(1);
  }
  // Neon: pooled host is "<endpoint>-pooler.<region>.aws.neon.tech";
  // the direct host drops "-pooler". No-op if "-pooler" isn't present.
  return pooled.replace("-pooler.", ".");
}

async function main() {
  const url = unpooledUrl();
  const store = PostgresStore.fromConnString(url);
  await store.setup();
  console.log("[setup-forge-store] forge store tables ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[setup-forge-store] FAILED:", err);
  process.exit(1);
});

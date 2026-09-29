import { Pool, type PoolClient } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";
import { safeErrorFields } from "@/lib/redaction/secrets";

// Module-level Pool is safe here: this app runs on Vercel Serverless
// (Node.js runtime) with Neon's pooled connection endpoint, not on Edge
// Functions or Cloudflare Workers. On Edge/Workers a Pool must live
// inside a single request handler — if anything in this repo ever
// switches to Edge, move the Pool construction into the route.
const pool = new Pool({ connectionString: process.env.DATABASE_URL! });

// A pooled connection that Neon drops emits `error`. The Neon client keeps the
// full DATABASE_URL, password included, on itself, and for an idle connection
// the pool pins that client onto the error as `err.client`. An `error` event
// nobody listens for is rethrown as an uncaught exception, which the runtime
// prints whole into the logs — so every connection gets a listener that logs
// only the safe fields. The pool hands out a connection with no listener of
// its own; one dropped mid-transaction still rejects its query, this only
// stops the crash, and the pool discards the dead client on release.
pool.on("connect", (client: PoolClient) => {
  client.on("error", (err: Error) => {
    console.error("[db] connection error", safeErrorFields(err));
  });
});
// The pool re-emits an idle connection's error after discarding it; the
// listener above has already logged it.
pool.on("error", () => {});

export const db = drizzle(pool, { schema });

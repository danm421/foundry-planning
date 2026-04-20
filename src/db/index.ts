import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

// Module-level Pool is safe here: this app runs on Vercel Serverless
// (Node.js runtime) with Neon's pooled connection endpoint, not on Edge
// Functions or Cloudflare Workers. On Edge/Workers a Pool must live
// inside a single request handler — if anything in this repo ever
// switches to Edge, move the Pool construction into the route.
const pool = new Pool({ connectionString: process.env.DATABASE_URL! });

export const db = drizzle(pool, { schema });

import { config } from "dotenv";

// Load non-VITE_ env vars (DATABASE_URL, etc.) from .env.local before any
// test file imports modules that read process.env at import time (notably
// src/db/index.ts). Vitest / Vite only expose VITE_ prefixed vars natively.
config({ path: ".env.local" });

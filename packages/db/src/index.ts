import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

const sql = neon(process.env.DATABASE_URL!);

export const db = drizzle(sql, { schema });

export type DB = ReturnType<typeof drizzle<typeof schema>>;

export { drizzleImpersonationSessionRepo } from './drizzle-impersonation-session-repo';
export { auditedMutation } from './audited-mutation';
export type { AuditedMutationEntry } from './audited-mutation';

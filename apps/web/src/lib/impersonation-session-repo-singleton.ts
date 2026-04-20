import { drizzleImpersonationSessionRepo, db } from '@foundry/db';

export const impersonationSessionRepo = drizzleImpersonationSessionRepo(db);

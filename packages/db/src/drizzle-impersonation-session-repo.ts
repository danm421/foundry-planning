import type { ImpersonationSessionRepo, ActiveImpersonationSession, AdminRole } from '@foundry/auth';
import { sql } from 'drizzle-orm';
import type { DB } from './index';

type Row = {
  id: string;
  admin_user_id: string;
  advisor_clerk_user_id: string;
  firm_id: string;
  expires_at: Date;
  role: AdminRole;
};

function toActive(r: Row): ActiveImpersonationSession {
  return {
    sessionId: r.id,
    actorAdminId: r.admin_user_id,
    advisorClerkUserId: r.advisor_clerk_user_id,
    firmId: r.firm_id,
    expiresAt: r.expires_at,
    role: r.role,
  };
}

export function drizzleImpersonationSessionRepo(db: DB): ImpersonationSessionRepo {
  return {
    async loadActive(sessionId) {
      const rows = await db.execute(sql`
        SELECT s.id, s.admin_user_id, s.advisor_clerk_user_id, s.firm_id, s.expires_at, a.role
          FROM admin_impersonation_sessions s
          JOIN admin_users a ON a.id = s.admin_user_id
         WHERE s.id = ${sessionId}
           AND s.ended_at IS NULL
           AND s.expires_at > now()
         LIMIT 1
      `);
      return rows.rows.length ? toActive(rows.rows[0] as unknown as Row) : null;
    },

    async consumeHandoffToken(tokenHash) {
      const rows = await db.execute(sql`
        WITH updated AS (
          UPDATE admin_impersonation_sessions
             SET handoff_consumed_at = now()
           WHERE handoff_token_hash = ${tokenHash}
             AND handoff_consumed_at IS NULL
             AND ended_at IS NULL
             AND expires_at > now()
          RETURNING id, admin_user_id, advisor_clerk_user_id, firm_id, expires_at
        )
        SELECT u.*, a.role
          FROM updated u
          JOIN admin_users a ON a.id = u.admin_user_id
      `);
      return rows.rows.length ? toActive(rows.rows[0] as unknown as Row) : null;
    },

    async end(sessionId) {
      await db.execute(sql`
        UPDATE admin_impersonation_sessions
           SET ended_at = COALESCE(ended_at, now())
         WHERE id = ${sessionId}
      `);
    },
  };
}

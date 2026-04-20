import type { AdminRole } from './context';

export type ActiveImpersonationSession = {
  sessionId: string;
  actorAdminId: string;
  advisorClerkUserId: string;
  firmId: string;
  role: AdminRole;
  expiresAt: Date;
};

export interface ImpersonationSessionRepo {
  /** Returns the active row for `sessionId` iff `ended_at IS NULL AND expires_at > now()`. */
  loadActive(sessionId: string): Promise<ActiveImpersonationSession | null>;
  /**
   * Atomically mark handoff as consumed. CAS on `handoff_token_hash` where `handoff_consumed_at IS NULL`.
   * Returns the session row if swap succeeded, null otherwise.
   */
  consumeHandoffToken(tokenHash: Buffer): Promise<ActiveImpersonationSession | null>;
  /** Sets `ended_at = now()` unconditionally (idempotent). */
  end(sessionId: string): Promise<void>;
}

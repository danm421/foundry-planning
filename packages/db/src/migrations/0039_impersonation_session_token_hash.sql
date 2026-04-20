ALTER TABLE admin_impersonation_sessions
  ADD COLUMN handoff_token_hash bytea,
  ADD COLUMN handoff_consumed_at timestamp;

CREATE UNIQUE INDEX admin_impersonation_sessions_handoff_token_hash_idx
  ON admin_impersonation_sessions (handoff_token_hash)
  WHERE handoff_token_hash IS NOT NULL;

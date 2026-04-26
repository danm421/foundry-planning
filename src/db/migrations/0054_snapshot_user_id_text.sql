-- scenario_snapshots.frozen_by_user_id was originally declared `uuid` in
-- migration 0050. Clerk user ids are strings like `user_2qXyZ...`, not uuids,
-- so the column type is wrong. Fix it before the table is first written to in
-- production (Plan 1 added the table but never inserted rows; Plan 2 Task 35
-- is the first writer).
--
-- Mirrors `audit_log.actor_id` which is `text`. Existing rows: none, so the
-- USING clause is unnecessary but kept for safety/idempotency.
ALTER TABLE "scenario_snapshots"
  ALTER COLUMN "frozen_by_user_id" TYPE text USING "frozen_by_user_id"::text;

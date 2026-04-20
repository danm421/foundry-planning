CREATE TABLE "admin_impersonation_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"advisor_clerk_user_id" text NOT NULL,
	"firm_id" text NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"ended_at" timestamp,
	"reason" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"disabled_at" timestamp,
	CONSTRAINT "admin_users_clerk_user_id_unique" UNIQUE("clerk_user_id")
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "acting_as_advisor_id" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "impersonation_session_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "prev_hash" "bytea";--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "row_hash" "bytea";--> statement-breakpoint
ALTER TABLE "admin_impersonation_sessions" ADD CONSTRAINT "admin_impersonation_sessions_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_impersonation_active_idx" ON "admin_impersonation_sessions" USING btree ("admin_user_id") WHERE "admin_impersonation_sessions"."ended_at" IS NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_impersonation_session_id_fk" FOREIGN KEY ("impersonation_session_id") REFERENCES "admin_impersonation_sessions"("id");--> statement-breakpoint
-- Backfill hash chain for existing audit_log rows, ordered deterministically
-- per firm_id. Uses a window function + pgcrypto's digest().
CREATE EXTENSION IF NOT EXISTS pgcrypto;--> statement-breakpoint
WITH ordered AS (
  SELECT id,
         firm_id,
         row_number() OVER (PARTITION BY firm_id ORDER BY created_at, id) AS rn,
         convert_to(
           coalesce(actor_id, '') || '|' ||
           coalesce(action, '') || '|' ||
           coalesce(resource_type, '') || '|' ||
           coalesce(resource_id, '') || '|' ||
           coalesce(client_id::text, '') || '|' ||
           coalesce(metadata::text, '') || '|' ||
           to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS'),
           'UTF8'
         ) AS payload
    FROM audit_log
),
chained AS (
  SELECT id,
         firm_id,
         rn,
         payload,
         digest(payload, 'sha256') AS self_hash
    FROM ordered
),
rollup AS (
  SELECT c.id,
         c.firm_id,
         c.rn,
         c.self_hash,
         lag(c.self_hash) OVER (PARTITION BY c.firm_id ORDER BY c.rn) AS prev
    FROM chained c
)
UPDATE audit_log al
   SET prev_hash = r.prev,
       row_hash  = digest(
                     coalesce(r.prev, ''::bytea) ||
                     (SELECT payload FROM ordered o WHERE o.id = r.id),
                     'sha256'
                   )
  FROM rollup r
 WHERE al.id = r.id;--> statement-breakpoint
-- Append-only enforcement. Applies to every role including the app role.
CREATE OR REPLACE FUNCTION audit_log_reject_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only (% not permitted)', TG_OP;
END;
$$;--> statement-breakpoint
CREATE TRIGGER audit_log_no_update
BEFORE UPDATE ON audit_log
FOR EACH ROW EXECUTE FUNCTION audit_log_reject_mutation();--> statement-breakpoint
CREATE TRIGGER audit_log_no_delete
BEFORE DELETE ON audit_log
FOR EACH ROW EXECUTE FUNCTION audit_log_reject_mutation();--> statement-breakpoint
-- Hash chain on insert. Computes row_hash from prev row's row_hash + this
-- row's canonical payload. Ties are broken by id to make ordering stable.
CREATE OR REPLACE FUNCTION audit_log_set_hash()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  prev bytea;
  payload bytea;
BEGIN
  SELECT row_hash INTO prev
    FROM audit_log
   WHERE firm_id = NEW.firm_id
   ORDER BY created_at DESC, id DESC
   LIMIT 1;

  payload := convert_to(
    coalesce(NEW.actor_id, '') || '|' ||
    coalesce(NEW.action, '') || '|' ||
    coalesce(NEW.resource_type, '') || '|' ||
    coalesce(NEW.resource_id, '') || '|' ||
    coalesce(NEW.client_id::text, '') || '|' ||
    coalesce(NEW.metadata::text, '') || '|' ||
    coalesce(NEW.acting_as_advisor_id, '') || '|' ||
    coalesce(NEW.impersonation_session_id::text, '') || '|' ||
    to_char(coalesce(NEW.created_at, now()) AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS'),
    'UTF8'
  );

  NEW.prev_hash := prev;
  NEW.row_hash  := digest(coalesce(prev, ''::bytea) || payload, 'sha256');
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER audit_log_hash_chain
BEFORE INSERT ON audit_log
FOR EACH ROW EXECUTE FUNCTION audit_log_set_hash();

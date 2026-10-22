-- Per-advisor integrations: each connection gets an owner and a name; each
-- household link gets its connection, the Addepar firm it came from and the
-- last pull. Order matters: add (connection_id nullable) -> backfill -> drop
-- unbackfillable links -> SET NOT NULL -> drop old indexes -> create new ones.
-- The old (firm_id, provider) unique index is still in place during the
-- backfill, so each (firm_id, provider) match below finds at most one row.

-- 1. Add the columns.
ALTER TABLE "integration_connections" ADD COLUMN "owner_user_id" text;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "integration_household_links" ADD COLUMN "connection_id" uuid;--> statement-breakpoint
ALTER TABLE "integration_household_links" ADD COLUMN "external_firm_id" text;--> statement-breakpoint
ALTER TABLE "integration_household_links" ADD COLUMN "last_pull_accounts" jsonb;--> statement-breakpoint
ALTER TABLE "integration_household_links" ADD COLUMN "last_pulled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "integration_sync_runs" ADD COLUMN "connection_id" uuid;--> statement-breakpoint
ALTER TABLE "integration_household_links" ADD CONSTRAINT "integration_household_links_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_runs" ADD CONSTRAINT "integration_sync_runs_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- 2a. Owner: whoever connected it, unless that was a token refresh
-- (system:...); then the earliest human integration.connect audit row.
UPDATE "integration_connections" c
SET "owner_user_id" = COALESCE(
  CASE
    WHEN c."connected_by_user_id" IS NOT NULL AND c."connected_by_user_id" NOT LIKE 'system:%'
    THEN c."connected_by_user_id"
  END,
  (
    SELECT a."actor_id"
    FROM "audit_log" a
    WHERE a."action" = 'integration.connect'
      AND a."firm_id" = c."firm_id"
      AND a."metadata"->>'provider' = c."provider"::text
      AND a."actor_id" NOT LIKE 'system%'
    ORDER BY a."created_at" ASC, a."id" ASC
    LIMIT 1
  )
)
WHERE c."provider" <> 'azure_openai';--> statement-breakpoint

-- 2b. Name: Addepar from the first label of scope.apiBase's host
-- (https://ethos.addepar.com -> "Ethos"; api.addepar.com or no usable
-- scope -> "Addepar"); the others take the provider label.
UPDATE "integration_connections" c
SET "name" = CASE c."provider"
  WHEN 'orion' THEN 'Orion'
  WHEN 'schwab' THEN 'Schwab'
  WHEN 'azure_openai' THEN 'Azure OpenAI'
  WHEN 'addepar' THEN
    CASE
      WHEN h."label" IS NULL OR h."label" = '' OR lower(h."label") = 'api' THEN 'Addepar'
      ELSE initcap(h."label")
    END
END
FROM (
  SELECT
    x."id",
    split_part(
      substring(
        CASE WHEN pg_input_is_valid(x."scope", 'jsonb') THEN x."scope"::jsonb->>'apiBase' END
        FROM '^(?:[A-Za-z][A-Za-z0-9+.-]*://)?([^/:?#]+)'
      ),
      '.',
      1
    ) AS "label"
  FROM "integration_connections" x
) h
WHERE h."id" = c."id";--> statement-breakpoint

-- 2c. Each link joins the one connection with its (firm_id, provider).
-- Addepar links copy the connection's Addepar firm ID.
UPDATE "integration_household_links" l
SET
  "connection_id" = c."id",
  "external_firm_id" = CASE
    WHEN l."provider" = 'addepar' AND pg_input_is_valid(c."scope", 'jsonb')
    THEN c."scope"::jsonb->>'addeparFirmId'
  END
FROM "integration_connections" c
WHERE c."firm_id" = l."firm_id" AND c."provider" = l."provider";--> statement-breakpoint

-- 2d. Old sync runs: same match; left null when there's none.
UPDATE "integration_sync_runs" r
SET "connection_id" = c."id"
FROM "integration_connections" c
WHERE c."firm_id" = r."firm_id" AND c."provider" = r."provider";--> statement-breakpoint

-- 2e. Open reviews the nightly run created (system:...) go to the owner of
-- the client's link connection, so the owner can open them.
UPDATE "client_imports" ci
SET "created_by_user_id" = c."owner_user_id"
FROM "integration_household_links" l
JOIN "integration_connections" c ON c."id" = l."connection_id"
WHERE ci."client_id" = l."client_id"
  AND ci."status" = 'review'
  AND ci."created_by_user_id" LIKE 'system:%'
  AND ci."origin"::text = l."provider"::text
  AND c."owner_user_id" IS NOT NULL;--> statement-breakpoint

-- 3. A link with no connection to join can't be synced; drop it.
DELETE FROM "integration_household_links" WHERE "connection_id" IS NULL;--> statement-breakpoint

-- 4.
ALTER TABLE "integration_household_links" ALTER COLUMN "connection_id" SET NOT NULL;--> statement-breakpoint

-- 5. Drop the old indexes.
DROP INDEX "integration_conn_firm_provider_uq";--> statement-breakpoint
DROP INDEX "integration_hh_firm_provider_hh_uq";--> statement-breakpoint

-- 6. Create the new ones.
CREATE UNIQUE INDEX "integration_conn_firm_azure_uq" ON "integration_connections" USING btree ("firm_id","provider") WHERE "integration_connections"."provider" = 'azure_openai';--> statement-breakpoint
CREATE UNIQUE INDEX "integration_conn_owner_oauth_uq" ON "integration_connections" USING btree ("firm_id","owner_user_id","provider") WHERE "integration_connections"."provider" IN ('orion','schwab');--> statement-breakpoint
CREATE UNIQUE INDEX "integration_hh_firm_provider_extfirm_hh_uq" ON "integration_household_links" USING btree ("firm_id","provider",coalesce("external_firm_id", ''),"external_household_id");

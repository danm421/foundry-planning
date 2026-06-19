CREATE TYPE "public"."import_origin" AS ENUM('extraction', 'orion');--> statement-breakpoint
CREATE TYPE "public"."orion_connection_status" AS ENUM('connected', 'disconnected', 'error');--> statement-breakpoint
CREATE TYPE "public"."orion_sync_trigger" AS ENUM('manual', 'cron');--> statement-breakpoint
ALTER TYPE "public"."source" ADD VALUE 'orion';--> statement-breakpoint
CREATE TABLE "orion_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" text NOT NULL,
	"access_token_enc" text NOT NULL,
	"refresh_token_enc" text,
	"token_expires_at" timestamp with time zone,
	"scope" text,
	"status" "orion_connection_status" DEFAULT 'connected' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_sync_error" text,
	"connected_by_user_id" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orion_connections_firm_id_unique" UNIQUE("firm_id")
);
--> statement-breakpoint
CREATE TABLE "orion_household_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" text NOT NULL,
	"client_id" uuid NOT NULL,
	"orion_household_id" text NOT NULL,
	"linked_by_user_id" text,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orion_household_links_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "orion_oauth_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" text NOT NULL,
	"user_id" text NOT NULL,
	"state" text NOT NULL,
	"code_verifier" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "orion_oauth_states_state_unique" UNIQUE("state")
);
--> statement-breakpoint
CREATE TABLE "orion_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" text NOT NULL,
	"trigger" "orion_sync_trigger" NOT NULL,
	"status" text NOT NULL,
	"households_synced" integer DEFAULT 0 NOT NULL,
	"accounts_committed" integer DEFAULT 0 NOT NULL,
	"accounts_queued" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "external_provider" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "last_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "client_imports" ADD COLUMN "origin" "import_origin" DEFAULT 'extraction' NOT NULL;--> statement-breakpoint
ALTER TABLE "orion_household_links" ADD CONSTRAINT "orion_household_links_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "orion_household_firm_hh_uq" ON "orion_household_links" USING btree ("firm_id","orion_household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_client_external_uq" ON "accounts" USING btree ("client_id","external_provider","external_id") WHERE "accounts"."external_id" IS NOT NULL;
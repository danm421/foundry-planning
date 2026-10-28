CREATE TYPE "public"."workspace_connection_status" AS ENUM('connected', 'needs_reconnect');--> statement-breakpoint
CREATE TYPE "public"."workspace_oauth_state_kind" AS ENUM('admin_consent', 'user_connect');--> statement-breakpoint
CREATE TYPE "public"."workspace_provider" AS ENUM('microsoft');--> statement-breakpoint
CREATE TABLE "workspace_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" text NOT NULL,
	"user_id" text NOT NULL,
	"provider" "workspace_provider" NOT NULL,
	"tenant_id" text NOT NULL,
	"external_user_id" text NOT NULL,
	"external_email" text NOT NULL,
	"access_token_enc" text NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"token_expires_at" timestamp with time zone NOT NULL,
	"scope" text NOT NULL,
	"status" "workspace_connection_status" DEFAULT 'connected' NOT NULL,
	"last_error" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_firm_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" text NOT NULL,
	"provider" "workspace_provider" NOT NULL,
	"tenant_id" text NOT NULL,
	"approved_scopes" text NOT NULL,
	"approved_by_user_id" text NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_member_access" (
	"firm_id" text NOT NULL,
	"user_id" text NOT NULL,
	"provider" "workspace_provider" NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_member_access_firm_id_user_id_provider_pk" PRIMARY KEY("firm_id","user_id","provider")
);
--> statement-breakpoint
CREATE TABLE "workspace_oauth_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" text NOT NULL,
	"provider" "workspace_provider" NOT NULL,
	"kind" "workspace_oauth_state_kind" NOT NULL,
	"user_id" text NOT NULL,
	"state" text NOT NULL,
	"code_verifier" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "workspace_oauth_states_state_unique" UNIQUE("state")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ws_conn_user_uq" ON "workspace_connections" USING btree ("firm_id","user_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "ws_conn_account_uq" ON "workspace_connections" USING btree ("firm_id","provider","external_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ws_firm_approval_uq" ON "workspace_firm_approvals" USING btree ("firm_id","provider");
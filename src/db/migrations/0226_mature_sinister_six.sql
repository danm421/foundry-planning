CREATE TYPE "public"."risk_binding_constraint" AS ENUM('tolerance', 'capacity', 'none');--> statement-breakpoint
CREATE TYPE "public"."risk_profile_event_kind" AS ENUM('profile_created', 'rtq_completed', 'tolerance_manual', 'environment_changed', 'capacity_changed');--> statement-breakpoint
CREATE TYPE "public"."risk_questionnaire_status" AS ENUM('draft', 'sent', 'submitted', 'applied', 'discarded', 'expired');--> statement-breakpoint
CREATE TYPE "public"."risk_questionnaire_subject" AS ENUM('primary', 'spouse');--> statement-breakpoint
CREATE TYPE "public"."risk_tolerance_source" AS ENUM('rtq_client', 'rtq_advisor', 'manual');--> statement-breakpoint
CREATE TABLE "client_risk_profile_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" text NOT NULL,
	"client_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" "risk_profile_event_kind" NOT NULL,
	"actor_user_id" text,
	"reason" text,
	"before_score" integer,
	"before_level" "risk_level",
	"after_score" integer,
	"after_level" "risk_level",
	"components" jsonb
);
--> statement-breakpoint
CREATE TABLE "client_risk_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" text NOT NULL,
	"client_id" uuid NOT NULL,
	"tolerance_score" integer,
	"tolerance_source" "risk_tolerance_source",
	"tolerance_confirmed_at" timestamp with time zone,
	"rtq_version" integer,
	"spouse_tolerance_score" integer,
	"spouse_rtq_version" integer,
	"capacity_score" integer,
	"capacity_factors" jsonb,
	"capacity_computed_at" timestamp with time zone,
	"required_growth_pct" integer,
	"environment_adj" integer DEFAULT 0 NOT NULL,
	"environment_reason" text,
	"environment_updated_at" timestamp with time zone,
	"composite_score" integer,
	"composite_level" "risk_level",
	"binding_constraint" "risk_binding_constraint" DEFAULT 'none' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_risk_profiles_env_adj_range" CHECK (environment_adj between -25 and 25),
	CONSTRAINT "client_risk_profiles_env_reason_required" CHECK (environment_adj = 0 or (environment_reason is not null and length(trim(environment_reason)) > 0))
);
--> statement-breakpoint
CREATE TABLE "risk_questionnaires" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" text NOT NULL,
	"client_id" uuid NOT NULL,
	"subject" "risk_questionnaire_subject" DEFAULT 'primary' NOT NULL,
	"token" text,
	"recipient_email" text,
	"recipient_name" text,
	"status" "risk_questionnaire_status" DEFAULT 'draft' NOT NULL,
	"rtq_version" integer NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"score" integer,
	"environment_note" text,
	"environment_note_reviewed_at" timestamp with time zone,
	"created_by_user_id" text NOT NULL,
	"sent_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_risk_profile_events" ADD CONSTRAINT "client_risk_profile_events_firm_id_firms_firm_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("firm_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_risk_profile_events" ADD CONSTRAINT "client_risk_profile_events_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_risk_profiles" ADD CONSTRAINT "client_risk_profiles_firm_id_firms_firm_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("firm_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_risk_profiles" ADD CONSTRAINT "client_risk_profiles_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_questionnaires" ADD CONSTRAINT "risk_questionnaires_firm_id_firms_firm_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("firm_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_questionnaires" ADD CONSTRAINT "risk_questionnaires_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_risk_profile_events_client_idx" ON "client_risk_profile_events" USING btree ("client_id","occurred_at");--> statement-breakpoint
CREATE INDEX "client_risk_profile_events_firm_idx" ON "client_risk_profile_events" USING btree ("firm_id");--> statement-breakpoint
CREATE UNIQUE INDEX "client_risk_profiles_client_idx" ON "client_risk_profiles" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "client_risk_profiles_firm_idx" ON "client_risk_profiles" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "client_risk_profiles_level_idx" ON "client_risk_profiles" USING btree ("firm_id","composite_level");--> statement-breakpoint
CREATE UNIQUE INDEX "risk_questionnaires_token_idx" ON "risk_questionnaires" USING btree ("token") WHERE token is not null;--> statement-breakpoint
CREATE INDEX "risk_questionnaires_client_idx" ON "risk_questionnaires" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "risk_questionnaires_firm_idx" ON "risk_questionnaires" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "risk_questionnaires_status_idx" ON "risk_questionnaires" USING btree ("status");
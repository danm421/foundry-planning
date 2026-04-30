CREATE TYPE "public"."acceptance_source" AS ENUM('stripe_checkout', 'clerk_signup', 'in_app_modal');--> statement-breakpoint
CREATE TYPE "public"."billing_event_result" AS ENUM('ok', 'error', 'ignored', 'skipped_duplicate');--> statement-breakpoint
CREATE TYPE "public"."reconciliation_run_status" AS ENUM('running', 'ok', 'drift_detected', 'error');--> statement-breakpoint
CREATE TYPE "public"."subscription_item_kind" AS ENUM('seat', 'addon');--> statement-breakpoint
CREATE TABLE "billing_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stripe_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"firm_id" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"processing_duration_ms" integer,
	"result" "billing_event_result",
	"error_message" text,
	"payload_redacted" jsonb,
	CONSTRAINT "billing_events_stripe_event_id_unique" UNIQUE("stripe_event_id")
);
--> statement-breakpoint
CREATE TABLE "firms" (
	"firm_id" text PRIMARY KEY NOT NULL,
	"display_name" text,
	"is_founder" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"data_retention_until" timestamp with time zone,
	"purged_at" timestamp with time zone,
	"dpa_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" text NOT NULL,
	"stripe_invoice_id" text NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"stripe_subscription_id" text,
	"status" text,
	"amount_due" integer,
	"amount_paid" integer,
	"currency" text,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"hosted_invoice_url" text,
	"invoice_pdf" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_stripe_invoice_id_unique" UNIQUE("stripe_invoice_id")
);
--> statement-breakpoint
CREATE TABLE "reconciliation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"status" "reconciliation_run_status" NOT NULL,
	"firms_checked" integer,
	"discrepancies_found" integer,
	"discrepancies" jsonb,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "subscription_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"firm_id" text NOT NULL,
	"stripe_item_id" text NOT NULL,
	"stripe_price_id" text NOT NULL,
	"kind" "subscription_item_kind" NOT NULL,
	"addon_key" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_amount" integer NOT NULL,
	"currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "subscription_items_stripe_item_id_unique" UNIQUE("stripe_item_id"),
	CONSTRAINT "subscription_items_addon_key_when_addon" CHECK (("subscription_items"."kind" = 'addon' AND "subscription_items"."addon_key" IS NOT NULL) OR ("subscription_items"."kind" = 'seat' AND "subscription_items"."addon_key" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" text NOT NULL,
	"stripe_subscription_id" text NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"status" text NOT NULL,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"canceled_at" timestamp with time zone,
	"trial_start" timestamp with time zone,
	"trial_end" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id")
);
--> statement-breakpoint
CREATE TABLE "tos_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"firm_id" text,
	"tos_version" text NOT NULL,
	"dpa_version" text,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" "inet",
	"user_agent" text,
	"acceptance_source" "acceptance_source" NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_firm_id_firms_firm_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("firm_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_items" ADD CONSTRAINT "subscription_items_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_items" ADD CONSTRAINT "subscription_items_firm_id_firms_firm_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("firm_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_firm_id_firms_firm_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("firm_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_events_firm_received_idx" ON "billing_events" USING btree ("firm_id","received_at");--> statement-breakpoint
CREATE INDEX "billing_events_errors_idx" ON "billing_events" USING btree ("received_at") WHERE result = 'error';--> statement-breakpoint
CREATE INDEX "invoices_firm_paid_idx" ON "invoices" USING btree ("firm_id","paid_at");--> statement-breakpoint
CREATE INDEX "reconciliation_runs_started_idx" ON "reconciliation_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "subscription_items_firm_kind_idx" ON "subscription_items" USING btree ("firm_id","kind");--> statement-breakpoint
CREATE INDEX "subscriptions_firm_status_idx" ON "subscriptions" USING btree ("firm_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_firm_active_unique" ON "subscriptions" USING btree ("firm_id") WHERE status IN ('trialing','active','past_due','unpaid');--> statement-breakpoint
CREATE INDEX "tos_acceptances_user_accepted_idx" ON "tos_acceptances" USING btree ("user_id","accepted_at");
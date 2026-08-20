CREATE TYPE "public"."disability_benefit_period" AS ENUM('to_age', 'to_ssnra', 'years', 'lifetime');--> statement-breakpoint
CREATE TYPE "public"."disability_earnings_mode" AS ENUM('salary', 'manual');--> statement-breakpoint
CREATE TYPE "public"."disability_insured" AS ENUM('client', 'spouse');--> statement-breakpoint
CREATE TYPE "public"."disability_premium_payer" AS ENUM('employer', 'insured');--> statement-breakpoint
CREATE TABLE "disability_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"insured" "disability_insured" NOT NULL,
	"carrier" text,
	"covered_earnings_mode" "disability_earnings_mode" DEFAULT 'salary' NOT NULL,
	"covered_earnings_amount" numeric(15, 2),
	"has_short_term" boolean DEFAULT true NOT NULL,
	"std_elimination_days" integer DEFAULT 7 NOT NULL,
	"std_benefit_pct" numeric(5, 4) DEFAULT '0.6000' NOT NULL,
	"std_duration_weeks" integer DEFAULT 13 NOT NULL,
	"std_monthly_max" numeric(15, 2),
	"has_long_term" boolean DEFAULT true NOT NULL,
	"ltd_elimination_days" integer DEFAULT 90 NOT NULL,
	"ltd_benefit_pct" numeric(5, 4) DEFAULT '0.6000' NOT NULL,
	"ltd_monthly_max" numeric(15, 2) DEFAULT '10000.00',
	"ltd_benefit_period_mode" "disability_benefit_period" DEFAULT 'to_age' NOT NULL,
	"ltd_benefit_period_age" integer DEFAULT 65,
	"ltd_benefit_period_years" integer,
	"benefit_taxable" boolean DEFAULT true NOT NULL,
	"cola_rate" numeric(5, 4) DEFAULT '0.0000' NOT NULL,
	"annual_premium" numeric(15, 2) DEFAULT '0' NOT NULL,
	"premium_payer" "disability_premium_payer" DEFAULT 'employer' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "disability_policies" ADD CONSTRAINT "disability_policies_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "disability_policies_client_idx" ON "disability_policies" USING btree ("client_id");
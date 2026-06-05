CREATE TYPE "public"."equity_exercise_timing" AS ENUM('at_vest', 'specific_year', 'year_before_expiration', 'manual');--> statement-breakpoint
CREATE TYPE "public"."equity_planned_action" AS ENUM('exercise', 'sell');--> statement-breakpoint
CREATE TYPE "public"."equity_sell_timing" AS ENUM('immediately', 'hold_then_sell_year', 'percent_per_year', 'hold');--> statement-breakpoint
CREATE TYPE "public"."grant_type" AS ENUM('rsu', 'nqso', 'iso');--> statement-breakpoint
ALTER TYPE "public"."account_category" ADD VALUE 'stock_options';--> statement-breakpoint
CREATE TABLE "stock_option_accounts" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"ticker" text,
	"is_public" boolean DEFAULT false NOT NULL,
	"price_per_share" numeric(15, 4) DEFAULT '0' NOT NULL,
	"destination_account_id" uuid,
	"auto_create_destination" boolean DEFAULT true NOT NULL,
	"sell_to_cover" boolean DEFAULT true NOT NULL,
	"withholding_rate" numeric(5, 4) DEFAULT '0.22' NOT NULL,
	"default_exercise_timing" "equity_exercise_timing" DEFAULT 'at_vest' NOT NULL,
	"default_exercise_year" integer,
	"default_sell_timing" "equity_sell_timing" DEFAULT 'hold' NOT NULL,
	"default_sell_year" integer,
	"default_sell_percent_per_year" numeric(5, 4),
	"default_sell_start_year" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_option_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"grant_number" text,
	"grant_type" "grant_type" NOT NULL,
	"grant_date" date NOT NULL,
	"shares_granted" numeric(18, 6) DEFAULT '0' NOT NULL,
	"has_83b_election" boolean DEFAULT false NOT NULL,
	"fmv_at_grant" numeric(15, 4),
	"strike_price" numeric(15, 4),
	"strike_discount_pct" numeric(5, 4),
	"expiration_date" date,
	"exercise_timing" "equity_exercise_timing",
	"exercise_year" integer,
	"sell_timing" "equity_sell_timing",
	"sell_year" integer,
	"sell_percent_per_year" numeric(5, 4),
	"sell_start_year" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_option_planned_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grant_id" uuid NOT NULL,
	"tranche_id" uuid,
	"year" integer NOT NULL,
	"action" "equity_planned_action" NOT NULL,
	"shares" numeric(18, 6),
	"pct" numeric(5, 4)
);
--> statement-breakpoint
CREATE TABLE "stock_option_vest_tranches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grant_id" uuid NOT NULL,
	"vest_date" date NOT NULL,
	"shares" numeric(18, 6) DEFAULT '0' NOT NULL,
	"shares_exercised" numeric(18, 6) DEFAULT '0' NOT NULL,
	"shares_sold" numeric(18, 6) DEFAULT '0' NOT NULL,
	"exercise_timing" "equity_exercise_timing",
	"exercise_year" integer,
	"sell_timing" "equity_sell_timing",
	"sell_year" integer,
	"sell_percent_per_year" numeric(5, 4),
	"sell_start_year" integer,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plan_settings" ADD COLUMN "default_growth_stock_options" numeric(5, 4) DEFAULT '0.07' NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_settings" ADD COLUMN "growth_source_stock_options" "growth_source" DEFAULT 'inflation' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_option_accounts" ADD CONSTRAINT "stock_option_accounts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_option_accounts" ADD CONSTRAINT "stock_option_accounts_destination_account_id_accounts_id_fk" FOREIGN KEY ("destination_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_option_grants" ADD CONSTRAINT "stock_option_grants_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_option_planned_events" ADD CONSTRAINT "stock_option_planned_events_grant_id_stock_option_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."stock_option_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_option_planned_events" ADD CONSTRAINT "stock_option_planned_events_tranche_id_stock_option_vest_tranches_id_fk" FOREIGN KEY ("tranche_id") REFERENCES "public"."stock_option_vest_tranches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_option_vest_tranches" ADD CONSTRAINT "stock_option_vest_tranches_grant_id_stock_option_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."stock_option_grants"("id") ON DELETE cascade ON UPDATE no action;
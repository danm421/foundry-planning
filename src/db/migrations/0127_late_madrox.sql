CREATE TABLE "account_flow_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"scenario_id" uuid,
	"year" integer NOT NULL,
	"income_amount" numeric(15, 2),
	"expense_amount" numeric(15, 2),
	"distribution_percent" numeric(5, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_flow_overrides_account_scenario_year_uniq" UNIQUE NULLS NOT DISTINCT("account_id","scenario_id","year")
);
--> statement-breakpoint
ALTER TABLE "account_flow_overrides" ADD CONSTRAINT "account_flow_overrides_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_flow_overrides" ADD CONSTRAINT "account_flow_overrides_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_flow_overrides_account_scenario_idx" ON "account_flow_overrides" USING btree ("account_id","scenario_id");
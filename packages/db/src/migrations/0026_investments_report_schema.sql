CREATE TABLE "report_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"scenario_id" uuid NOT NULL,
	"report_key" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plan_settings" ADD COLUMN "selected_benchmark_portfolio_id" uuid;--> statement-breakpoint
ALTER TABLE "report_comments" ADD CONSTRAINT "report_comments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_comments" ADD CONSTRAINT "report_comments_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "report_comments_client_scenario_key_unique" ON "report_comments" USING btree ("client_id","scenario_id","report_key");--> statement-breakpoint
ALTER TABLE "plan_settings" ADD CONSTRAINT "plan_settings_selected_benchmark_portfolio_id_model_portfolios_id_fk" FOREIGN KEY ("selected_benchmark_portfolio_id") REFERENCES "public"."model_portfolios"("id") ON DELETE set null ON UPDATE no action;
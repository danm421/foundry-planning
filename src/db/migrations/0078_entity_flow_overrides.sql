CREATE TABLE "entity_flow_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"scenario_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"income_amount" numeric(15, 2),
	"expense_amount" numeric(15, 2),
	"distribution_percent" numeric(5, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entity_flow_overrides" ADD CONSTRAINT "entity_flow_overrides_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_flow_overrides" ADD CONSTRAINT "entity_flow_overrides_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "entity_flow_overrides_entity_scenario_year_idx" ON "entity_flow_overrides" USING btree ("entity_id","scenario_id","year");--> statement-breakpoint
CREATE INDEX "entity_flow_overrides_entity_scenario_idx" ON "entity_flow_overrides" USING btree ("entity_id","scenario_id");
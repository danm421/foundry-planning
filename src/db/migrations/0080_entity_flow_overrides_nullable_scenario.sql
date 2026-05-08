DROP INDEX "entity_flow_overrides_entity_scenario_year_idx";--> statement-breakpoint
ALTER TABLE "entity_flow_overrides" ALTER COLUMN "scenario_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "entity_flow_overrides" ADD CONSTRAINT "entity_flow_overrides_entity_scenario_year_uniq" UNIQUE NULLS NOT DISTINCT("entity_id","scenario_id","year");
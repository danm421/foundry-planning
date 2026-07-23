CREATE TYPE "public"."risk_level" AS ENUM('conservative', 'moderately_conservative', 'moderate', 'moderately_aggressive', 'aggressive');--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "risk_tolerance" "risk_level";--> statement-breakpoint
ALTER TABLE "model_portfolios" ADD COLUMN "risk_level" "risk_level";--> statement-breakpoint
CREATE UNIQUE INDEX "model_portfolios_firm_risk_level_uniq" ON "model_portfolios" USING btree ("firm_id","risk_level") WHERE risk_level is not null;
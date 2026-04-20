-- Prevent duplicate asset classes and model portfolios within a firm.
-- Required because the seed endpoint can race when React strict-mode fires
-- the effect twice, and the Neon HTTP driver doesn't support transactions
-- for advisory locking.
ALTER TABLE "asset_classes" ADD CONSTRAINT "asset_classes_firm_id_name_unique" UNIQUE("firm_id", "name");
--> statement-breakpoint
ALTER TABLE "model_portfolios" ADD CONSTRAINT "model_portfolios_firm_id_name_unique" UNIQUE("firm_id", "name");

CREATE INDEX "accounts_client_scenario_idx" ON "accounts" USING btree ("client_id","scenario_id");--> statement-breakpoint
CREATE INDEX "entities_client_idx" ON "entities" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "expenses_client_scenario_idx" ON "expenses" USING btree ("client_id","scenario_id");--> statement-breakpoint
CREATE INDEX "incomes_client_scenario_idx" ON "incomes" USING btree ("client_id","scenario_id");--> statement-breakpoint
CREATE INDEX "liabilities_client_scenario_idx" ON "liabilities" USING btree ("client_id","scenario_id");--> statement-breakpoint
CREATE INDEX "savings_rules_client_scenario_idx" ON "savings_rules" USING btree ("client_id","scenario_id");--> statement-breakpoint
CREATE INDEX "scenario_snapshots_client_idx" ON "scenario_snapshots" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "scenario_toggle_groups_scenario_idx" ON "scenario_toggle_groups" USING btree ("scenario_id");--> statement-breakpoint
CREATE INDEX "scenarios_client_idx" ON "scenarios" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "withdrawal_strategies_client_scenario_idx" ON "withdrawal_strategies" USING btree ("client_id","scenario_id");
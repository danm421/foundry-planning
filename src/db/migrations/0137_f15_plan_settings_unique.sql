-- Audit F15: enforce one plan_settings row per (client, scenario) so a
-- concurrent POST / retry can't duplicate it ("first row wins" silently).
-- Hand-authored (not drizzle-kit output) to carry IF NOT EXISTS: the journal is
-- ahead of some environments (renumbering drift, same class as plaid_items/F14),
-- so a plain CREATE UNIQUE INDEX could collide. scenario_id is NOT NULL, so no
-- NULLS NOT DISTINCT is needed. Verified 0 duplicate (client_id, scenario_id)
-- groups on dev br-curly-cell before authoring.
CREATE UNIQUE INDEX IF NOT EXISTS "plan_settings_client_id_scenario_id_idx" ON "plan_settings" USING btree ("client_id","scenario_id");

-- Enforces parent-spec §3.2 invariant: only base-case scenario rows may live
-- in the 10 scenario-bearing tables. Any non-base scenario_id INSERT or
-- UPDATE raises an exception. Plan 2 routes all non-base writes to
-- scenario_changes via a unified writer route.

CREATE OR REPLACE FUNCTION assert_scenario_is_base_case()
RETURNS TRIGGER AS $$
DECLARE
  v_is_base BOOLEAN;
BEGIN
  IF NEW.scenario_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT is_base_case INTO v_is_base
  FROM scenarios
  WHERE id = NEW.scenario_id;

  IF v_is_base IS NULL THEN
    RAISE EXCEPTION 'scenario_id % does not reference an existing scenario', NEW.scenario_id;
  END IF;

  IF v_is_base = false THEN
    RAISE EXCEPTION 'scenario_id % references a non-base scenario; only base-case rows may be written to %', NEW.scenario_id, TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER accounts_scenario_base_only
  BEFORE INSERT OR UPDATE OF scenario_id ON accounts
  FOR EACH ROW EXECUTE FUNCTION assert_scenario_is_base_case();
--> statement-breakpoint
CREATE TRIGGER liabilities_scenario_base_only
  BEFORE INSERT OR UPDATE OF scenario_id ON liabilities
  FOR EACH ROW EXECUTE FUNCTION assert_scenario_is_base_case();
--> statement-breakpoint
CREATE TRIGGER incomes_scenario_base_only
  BEFORE INSERT OR UPDATE OF scenario_id ON incomes
  FOR EACH ROW EXECUTE FUNCTION assert_scenario_is_base_case();
--> statement-breakpoint
CREATE TRIGGER expenses_scenario_base_only
  BEFORE INSERT OR UPDATE OF scenario_id ON expenses
  FOR EACH ROW EXECUTE FUNCTION assert_scenario_is_base_case();
--> statement-breakpoint
CREATE TRIGGER savings_rules_scenario_base_only
  BEFORE INSERT OR UPDATE OF scenario_id ON savings_rules
  FOR EACH ROW EXECUTE FUNCTION assert_scenario_is_base_case();
--> statement-breakpoint
CREATE TRIGGER withdrawal_strategies_scenario_base_only
  BEFORE INSERT OR UPDATE OF scenario_id ON withdrawal_strategies
  FOR EACH ROW EXECUTE FUNCTION assert_scenario_is_base_case();
--> statement-breakpoint
CREATE TRIGGER transfers_scenario_base_only
  BEFORE INSERT OR UPDATE OF scenario_id ON transfers
  FOR EACH ROW EXECUTE FUNCTION assert_scenario_is_base_case();
--> statement-breakpoint
CREATE TRIGGER asset_transactions_scenario_base_only
  BEFORE INSERT OR UPDATE OF scenario_id ON asset_transactions
  FOR EACH ROW EXECUTE FUNCTION assert_scenario_is_base_case();
--> statement-breakpoint
CREATE TRIGGER client_deductions_scenario_base_only
  BEFORE INSERT OR UPDATE OF scenario_id ON client_deductions
  FOR EACH ROW EXECUTE FUNCTION assert_scenario_is_base_case();
--> statement-breakpoint
CREATE TRIGGER plan_settings_scenario_base_only
  BEFORE INSERT OR UPDATE OF scenario_id ON plan_settings
  FOR EACH ROW EXECUTE FUNCTION assert_scenario_is_base_case();

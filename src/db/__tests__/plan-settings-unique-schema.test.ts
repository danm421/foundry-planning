import { describe, it, expect } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { planSettings } from "../schema";

/**
 * plan_settings is one-row-per-(client, scenario). Without a unique constraint a
 * concurrent POST / retry can duplicate the row and "first row wins" silently
 * (audit F15). The live dev DB already enforces this with a unique index named
 * `plan_settings_client_id_scenario_id_idx`; schema.ts must declare it so Drizzle
 * is the source of truth and the guarantee survives schema regeneration.
 */
describe("plan_settings schema", () => {
  it("declares a UNIQUE index on (client_id, scenario_id)", () => {
    const cfg = getTableConfig(planSettings);
    const unique = cfg.indexes.find(
      (i) =>
        i.config.unique === true &&
        i.config.columns.map((c) => (c as { name: string }).name).join(",") ===
          "client_id,scenario_id",
    );
    expect(unique, "expected a unique index on (client_id, scenario_id)").toBeDefined();
    expect(unique?.config.name).toBe("plan_settings_client_id_scenario_id_idx");
  });
});

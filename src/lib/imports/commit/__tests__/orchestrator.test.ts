import { describe, expect, it } from "vitest";

import { markTabsCommitted } from "../orchestrator";
import { presenceFromPayload, requiredCommitTabs } from "../../required-tabs";
import type { ImportPayload } from "../../types";
import { makeFakeTx } from "../../__tests__/commit-test-helpers";

function emptyPayload(): ImportPayload {
  return {
    dependents: [],
    accounts: [],
    incomes: [],
    expenses: [],
    liabilities: [],
    lifePolicies: [],
    wills: [],
    entities: [],
    warnings: [],
  };
}

describe("markTabsCommitted completeness (regression: unreachable 'committed')", () => {
  it("flips to committed when every REQUIRED tab is committed, even with categories absent", async () => {
    // The walkthrough import: accounts + incomes + entities only.
    const payload: ImportPayload = {
      ...emptyPayload(),
      accounts: [{}] as ImportPayload["accounts"],
      incomes: [{}] as ImportPayload["incomes"],
      entities: [{}] as ImportPayload["entities"],
    };

    const required = requiredCommitTabs(presenceFromPayload(payload));
    expect(required).toEqual(["plan-basics", "accounts", "incomes", "entities"]);

    const fake = makeFakeTx();
    // No prior commits recorded for this import.
    fake.setSelectResult("client_imports", []);

    // Commit exactly the required tabs in one pass, as commitTabs would.
    const result = await markTabsCommitted(fake.tx, "imp-1", required, payload);

    expect(result.allTabsCommitted).toBe(true);
    expect(result.firstTimeAllCommitted).toBe(true);
  });

  it("does NOT flip when a required tab is still missing", async () => {
    // Required tabs are accounts + incomes, but only accounts commits here.
    const payload: ImportPayload = {
      ...emptyPayload(),
      accounts: [{}] as ImportPayload["accounts"],
      incomes: [{}] as ImportPayload["incomes"],
    };

    const required = requiredCommitTabs(presenceFromPayload(payload));
    expect(required).toEqual(["plan-basics", "accounts", "incomes"]);

    const fake = makeFakeTx();
    fake.setSelectResult("client_imports", []);

    const result = await markTabsCommitted(fake.tx, "imp-2", ["accounts"], payload);

    expect(result.allTabsCommitted).toBe(false);
    expect(result.firstTimeAllCommitted).toBe(false);
  });
});

/**
 * A row the matcher left ambiguous (`match.kind === "fuzzy"`) is skipped at
 * commit. Before this, the only trace was `CommitResult.skipped`, which no
 * component renders — so the advisor committed and the row silently never
 * landed. These tests pin that the skip now surfaces through `warnings`, which
 * the review wizard already shows via `WarningsBanner`.
 *
 * Exercised end-to-end through `commitTabs` (not the helper in isolation) so
 * the orchestrator wiring is covered too.
 */
import { describe, expect, it, vi } from "vitest";

import { commitTabs } from "@/lib/imports/commit/orchestrator";
import { emptyImportPayload, type ImportPayload } from "@/lib/imports/types";

const ctx = {
  clientId: "client-1",
  scenarioId: "scenario-1",
  orgId: "org-1",
  userId: "user-1",
};

function emptyPayload(): ImportPayload {
  return emptyImportPayload();
}

vi.mock("@/db", async () => {
  const { makeFakeTx } = await import("./commit-test-helpers");
  const fake = makeFakeTx();
  return {
    db: {
      transaction: async <T,>(fn: (tx: typeof fake.tx) => Promise<T>) => fn(fake.tx),
    },
  };
});

const AMBIGUOUS_2 =
  "2 account rows were left ambiguous and not imported — resolve their matches in the review step and re-commit.";

describe("ambiguous-skip warnings", () => {
  it("summarises fuzzy account rows in ONE warning on the accounts result", async () => {
    const payload: ImportPayload = {
      ...emptyPayload(),
      accounts: [
        { name: "Schwab Brokerage", category: "taxable", value: 100, match: { kind: "fuzzy", candidates: [{ id: "acct-1", score: 0.6 }] } },
        { name: "Fidelity IRA", category: "retirement", value: 200, match: { kind: "fuzzy", candidates: [{ id: "acct-2", score: 0.5 }] } },
        { name: "Chase Checking", category: "cash", value: 50, match: { kind: "new" } },
      ] as ImportPayload["accounts"],
    };

    const { results } = await commitTabs({
      importId: "imp-fuzzy",
      payload,
      tabs: ["accounts"],
      ctx,
    });

    expect(results.accounts.skipped).toBe(2);
    expect(results.accounts.created).toBe(1);
    // One warning for the tab, not one per row.
    expect(results.accounts.warnings).toEqual([AMBIGUOUS_2]);
  });

  it("does NOT warn when nothing was skipped", async () => {
    const payload: ImportPayload = {
      ...emptyPayload(),
      accounts: [
        { name: "Chase Checking", category: "cash", value: 50, match: { kind: "new" } },
      ] as ImportPayload["accounts"],
    };

    const { results } = await commitTabs({
      importId: "imp-clean",
      payload,
      tabs: ["accounts"],
      ctx,
    });

    expect(results.accounts.skipped).toBe(0);
    expect(results.accounts.warnings).toEqual([]);
  });

  it("does NOT call a non-fuzzy skip ambiguous", async () => {
    // commitAccounts also skips an `exact` row whose existingId went missing.
    // That is a different failure and must not be reported as ambiguity.
    const payload: ImportPayload = {
      ...emptyPayload(),
      accounts: [
        { name: "Orphaned Match", category: "taxable", value: 10, match: { kind: "exact" } },
      ] as unknown as ImportPayload["accounts"],
    };

    const { results } = await commitTabs({
      importId: "imp-orphan",
      payload,
      tabs: ["accounts"],
      ctx,
    });

    expect(results.accounts.skipped).toBe(1);
    expect(results.accounts.warnings).toEqual([]);
  });

  it("uses singular wording and the right noun on another tab", async () => {
    const payload: ImportPayload = {
      ...emptyPayload(),
      entities: [
        { name: "Smith Family Trust", entityType: "trust", match: { kind: "fuzzy", candidates: [{ id: "ent-1", score: 0.8 }] } },
      ] as ImportPayload["entities"],
    };

    const { results } = await commitTabs({
      importId: "imp-entity",
      payload,
      tabs: ["entities"],
      ctx,
    });

    expect(results.entities.warnings).toEqual([
      "1 entity row was left ambiguous and not imported — resolve its match in the review step and re-commit.",
    ]);
  });
});

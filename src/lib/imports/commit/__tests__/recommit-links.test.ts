/**
 * Re-commit idempotency.
 *
 * An import used to be a one-shot: the commit modules wrote canonical rows but
 * never recorded WHICH row each payload row created, so the payload still said
 * `{ kind: "new" }` afterwards. Committing the same tab again therefore INSERTed
 * a second copy of everything. The details wizard hid that behind a permanently
 * disabled button; the onboarding drawer's "Apply again" did not, and duplicated.
 *
 * The fix is `linkCreated`: each module stamps the new row's id onto the payload
 * row as `{ kind: "exact", existingId }`, and the orchestrator persists the
 * mutated payload. These tests pin that down the only way that actually
 * discriminates the bug — by running each module TWICE over the SAME payload
 * object and asserting the second pass updates rather than inserts.
 */
import { describe, expect, it } from "vitest";

import { emptyImportPayload, type Annotated, type ImportPayload } from "../../types";
import {
  adoptMatches,
  LINKED_SECTIONS,
  unlinkForCommitTabs,
  unlinkRows,
} from "../../commit-links";
import { makeFakeTx, callsForTable } from "../../__tests__/commit-test-helpers";
import { commitAccounts } from "../accounts";
import { commitEntities } from "../entities";
import { commitExpenses } from "../expenses";
import { commitIncomes } from "../incomes";
import { commitLiabilities } from "../liabilities";
import { commitSavings } from "../savings";
import type { CommitContext } from "../types";
import type { FamilyRoleIds } from "../family-resolver";

const CTX: CommitContext = {
  clientId: "client-1",
  scenarioId: "scenario-1",
  orgId: "org-1",
  userId: "user-1",
};

const FAMILY: FamilyRoleIds = { clientFmId: "fm-client", spouseFmId: null };

describe("re-commit updates the records it created instead of duplicating", () => {
  it("accounts: second pass UPDATEs the account the first pass inserted", async () => {
    const payload: ImportPayload = {
      ...emptyImportPayload(),
      accounts: [
        { name: "Joint Brokerage", value: 100, match: { kind: "new" } },
      ] as ImportPayload["accounts"],
    };

    const first = makeFakeTx();
    first.setInsertId("accounts", "acct-99");
    const r1 = await commitAccounts(first.tx, payload, CTX, FAMILY);

    expect(r1.created).toBe(1);
    expect(callsForTable(first.calls, "accounts").filter((c) => c.op === "insert")).toHaveLength(1);
    // The link is now on the payload — this is what makes pass 2 an update.
    expect(payload.accounts[0].match).toEqual({ kind: "exact", existingId: "acct-99" });

    const second = makeFakeTx();
    const r2 = await commitAccounts(second.tx, payload, CTX, FAMILY);

    expect(r2.created).toBe(0);
    expect(r2.updated).toBe(1);
    expect(callsForTable(second.calls, "accounts").filter((c) => c.op === "insert")).toHaveLength(0);
    expect(callsForTable(second.calls, "accounts").filter((c) => c.op === "update")).toHaveLength(1);
  });

  it("accounts: a re-commit carries the advisor's edited value onto the linked row", async () => {
    const payload: ImportPayload = {
      ...emptyImportPayload(),
      accounts: [{ name: "IRA", value: 100, match: { kind: "new" } }] as ImportPayload["accounts"],
    };

    const first = makeFakeTx();
    first.setInsertId("accounts", "acct-7");
    await commitAccounts(first.tx, payload, CTX, FAMILY);

    // Advisor corrects the balance in the review step, then re-commits.
    (payload.accounts[0] as { value?: number }).value = 250;

    const second = makeFakeTx();
    await commitAccounts(second.tx, payload, CTX, FAMILY);

    const update = callsForTable(second.calls, "accounts").find((c) => c.op === "update");
    expect(update?.values).toMatchObject({ value: "250" });
  });

  it("incomes: second pass UPDATEs rather than inserting", async () => {
    const payload: ImportPayload = {
      ...emptyImportPayload(),
      incomes: [
        { name: "Salary", type: "salary", annualAmount: 200_000, match: { kind: "new" } },
      ] as ImportPayload["incomes"],
    };

    const first = makeFakeTx();
    first.setInsertId("incomes", "inc-1");
    const r1 = await commitIncomes(first.tx, payload, CTX);
    expect(r1.created).toBe(1);
    expect(payload.incomes[0].match).toEqual({ kind: "exact", existingId: "inc-1" });

    const second = makeFakeTx();
    const r2 = await commitIncomes(second.tx, payload, CTX);
    expect(r2.created).toBe(0);
    expect(r2.updated).toBe(1);
  });

  it("expenses: second pass UPDATEs rather than inserting", async () => {
    const payload: ImportPayload = {
      ...emptyImportPayload(),
      expenses: [
        { name: "Travel", type: "other", annualAmount: 12_000, match: { kind: "new" } },
      ] as ImportPayload["expenses"],
    };

    const first = makeFakeTx();
    first.setInsertId("expenses", "exp-1");
    const r1 = await commitExpenses(first.tx, payload, CTX);
    expect(r1.created).toBe(1);
    expect(payload.expenses[0].match).toEqual({ kind: "exact", existingId: "exp-1" });

    const second = makeFakeTx();
    const r2 = await commitExpenses(second.tx, payload, CTX);
    expect(r2.created).toBe(0);
    expect(r2.updated).toBe(1);
  });

  it("liabilities: second pass UPDATEs rather than inserting", async () => {
    const payload: ImportPayload = {
      ...emptyImportPayload(),
      liabilities: [
        { name: "Mortgage", balance: 400_000, match: { kind: "new" } },
      ] as ImportPayload["liabilities"],
    };

    const first = makeFakeTx();
    first.setInsertId("liabilities", "liab-1");
    const r1 = await commitLiabilities(first.tx, payload, CTX, FAMILY);
    expect(r1.created).toBe(1);
    expect(payload.liabilities[0].match).toEqual({ kind: "exact", existingId: "liab-1" });

    const second = makeFakeTx();
    const r2 = await commitLiabilities(second.tx, payload, CTX, FAMILY);
    expect(r2.created).toBe(0);
    expect(r2.updated).toBe(1);
  });

  it("entities: second pass UPDATEs rather than inserting", async () => {
    const payload: ImportPayload = {
      ...emptyImportPayload(),
      entities: [
        { name: "Family Trust", entityType: "trust", match: { kind: "new" } },
      ] as ImportPayload["entities"],
    };

    const first = makeFakeTx();
    first.setInsertId("entities", "ent-1");
    const r1 = await commitEntities(first.tx, payload, CTX);
    expect(r1.created).toBe(1);
    expect(payload.entities[0].match).toEqual({ kind: "exact", existingId: "ent-1" });

    const second = makeFakeTx();
    const r2 = await commitEntities(second.tx, payload, CTX);
    expect(r2.created).toBe(0);
    expect(r2.updated).toBe(1);
  });
});

describe("savings re-commit (many payload legs fold into one rule)", () => {
  it("stamps the rule id onto BOTH folded legs, then updates once on re-commit", async () => {
    const payload: ImportPayload = {
      ...emptyImportPayload(),
      savings: [
        {
          name: "401(k) employee",
          destinationAccountName: "Zach 401(k)",
          owner: "client",
          annualPercent: 0.1,
          contributionRole: "employee",
          match: { kind: "new" },
        },
        {
          name: "401(k) employer",
          destinationAccountName: "Zach 401(k)",
          owner: "client",
          employerMatchPct: 0.05,
          contributionRole: "employer",
          match: { kind: "new" },
        },
      ] as ImportPayload["savings"],
    };

    const one = makeFakeTx();
    one.setSelectResult("accounts", [{ id: "acct-1", name: "Zach 401(k)" }]);
    one.setInsertId("savings_rules", "rule-1");
    const r1 = await commitSavings(one.tx, payload, CTX);

    expect(r1.created).toBe(1);
    expect(callsForTable(one.calls, "savings_rules").filter((c) => c.op === "insert")).toHaveLength(1);
    // The fold is many-to-one, so EVERY leg carries the rule's id — otherwise a
    // re-commit that reads only the first leg would insert a second rule.
    expect(payload.savings[0].match).toEqual({ kind: "exact", existingId: "rule-1" });
    expect(payload.savings[1].match).toEqual({ kind: "exact", existingId: "rule-1" });

    const two = makeFakeTx();
    two.setSelectResult("accounts", [{ id: "acct-1", name: "Zach 401(k)" }]);
    const r2 = await commitSavings(two.tx, payload, CTX);

    expect(r2.created).toBe(0);
    expect(r2.updated).toBe(1);
    expect(callsForTable(two.calls, "savings_rules").filter((c) => c.op === "insert")).toHaveLength(0);
    expect(callsForTable(two.calls, "savings_rules").filter((c) => c.op === "update")).toHaveLength(1);
  });
});

describe("adoptMatches (the client's half of the contract)", () => {
  type Row = Annotated<{ name: string }>;

  it("carries the server's links onto the client's own rows", () => {
    const prev: Row[] = [{ name: "IRA", match: { kind: "new" } }];
    const server: Row[] = [{ name: "IRA", match: { kind: "exact", existingId: "a-1" } }];
    expect(adoptMatches(prev, server)[0].match).toEqual({ kind: "exact", existingId: "a-1" });
  });

  it("refuses a positional match whose label disagrees", () => {
    // The advisor removed one row and added another while the commit was in
    // flight: same length, different rows. Adopting by index here would point
    // the NEXT commit at someone else's record — worse than the bug being
    // fixed — so the mismatched row keeps its own annotation.
    const prev: Row[] = [{ name: "Roth IRA", match: { kind: "new" } }];
    const server: Row[] = [
      { name: "Joint Brokerage", match: { kind: "exact", existingId: "a-9" } },
    ];
    expect(adoptMatches(prev, server)[0].match).toEqual({ kind: "new" });
  });

  it("no-ops when the section lengths disagree", () => {
    const prev: Row[] = [{ name: "A", match: { kind: "new" } }];
    const server: Row[] = [
      { name: "A", match: { kind: "exact", existingId: "1" } },
      { name: "B", match: { kind: "exact", existingId: "2" } },
    ];
    expect(adoptMatches(prev, server)).toBe(prev);
  });

  it("covers savings — the section the onboarding drawer commits but used to freeze", () => {
    // Regression: STEP_COMMIT_TABS.accounts includes "savings", so the drawer
    // commits savings rules. It held them as a frozen mount prop and never
    // adopted their link, so "Apply again" duplicated the rule.
    expect(LINKED_SECTIONS).toContain("savings");
  });
});

describe("commit as new", () => {
  it("unlinking makes the next commit INSERT a second record", async () => {
    const payload: ImportPayload = {
      ...emptyImportPayload(),
      accounts: [{ name: "Brokerage", value: 10, match: { kind: "new" } }] as ImportPayload["accounts"],
    };

    const first = makeFakeTx();
    first.setInsertId("accounts", "acct-a");
    await commitAccounts(first.tx, payload, CTX, FAMILY);
    expect(payload.accounts[0].match).toEqual({ kind: "exact", existingId: "acct-a" });

    // Exactly what the wizard's "Commit as new" button does — the shipped
    // helper, not a re-derivation of its rule.
    const unlinked = unlinkForCommitTabs(payload, ["accounts"]);
    expect(unlinked.accounts[0].match).toEqual({ kind: "new" });
    // Non-mutating: the wizard holds these rows in React state.
    expect(payload.accounts[0].match).toEqual({ kind: "exact", existingId: "acct-a" });
    payload.accounts = unlinked.accounts;

    const second = makeFakeTx();
    second.setInsertId("accounts", "acct-b");
    const r2 = await commitAccounts(second.tx, payload, CTX, FAMILY);

    expect(r2.created).toBe(1);
    expect(r2.updated).toBe(0);
    // ...and the fresh record is what the payload now points at.
    expect(payload.accounts[0].match).toEqual({ kind: "exact", existingId: "acct-b" });
  });

  it("leaves fuzzy rows alone — they carry candidates, not a link", async () => {
    const rows = [
      { name: "A", match: { kind: "exact" as const, existingId: "x" } },
      { name: "B", match: { kind: "fuzzy" as const, candidates: [{ id: "c1", score: 0.7 }] } },
      { name: "C", match: { kind: "new" as const } },
    ];

    const out = unlinkRows(rows);
    expect(out[0].match).toEqual({ kind: "new" });
    // Unchanged: forcing this to "new" would create the very duplicate the
    // advisor is being asked to rule on.
    expect(out[1].match).toEqual({ kind: "fuzzy", candidates: [{ id: "c1", score: 0.7 }] });
    expect(out[2].match).toEqual({ kind: "new" });
  });
});

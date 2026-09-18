// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AccountsTable from "../accounts-table";

const rows = [
  { __rowId: "r1", name: "Schwab Taxable 0707", value: 8_618.6, basis: 3_919.45,
    accountNumberLast4: "0990", custodian: "Charles Schwab",
    category: "taxable", subType: "brokerage",
    owners: [{ kind: "family_member", familyMemberId: "fm-1", percent: 1 }] },
  { __rowId: "r2", name: "Schwab Roth IRA", value: 22_873.46, basis: 10_010.17,
    accountNumberLast4: "1168", custodian: "Charles Schwab",
    category: "retirement", subType: "roth_ira",
    ownerNameHint: "MICHAEL V SHARESKY ROTH IRA" },
] as never;

/**
 * The plan these statements are being imported INTO. Passed only to the tests
 * that are about resolving owners; the rest deliberately render without it, so
 * they keep exercising the "roster cannot answer" path — printed registration
 * name, marked unconfirmed — which is still a real state (no family members on
 * the plan yet, or a registration line naming nobody on it).
 */
const CTX = {
  family: [
    { id: "fm-1", role: "client" as const, firstName: "Michael", lastName: "Sharesky" },
    { id: "fm-2", role: "spouse" as const, firstName: "Julia", lastName: "Sharesky" },
  ],
  entities: [],
};

describe("accounts table", () => {
  it("renders the nine spec columns in order", () => {
    render(<AccountsTable rows={rows} excluded={[]} committedRowIds={[]} onCommitRows={vi.fn()} onEditCell={vi.fn()} onEditHolding={vi.fn()} onDropHolding={vi.fn()} />);
    // Leading "" is the Task 5 disclosure column's header cell — AccountsTable
    // always supplies `expand` to EntityTable now, so every row gets one,
    // trailing "" is still the Commit column's. Match sits AFTER Holdings so
    // the cell indices the tests below pin (Owner at 5) keep holding.
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "", "Name", "Value", "Basis", "Last 4", "Owner", "Custodian", "Account type", "Holdings", "Match", "",
    ]);
  });

  it("commits a single row without touching its neighbours", async () => {
    const onCommitRows = vi.fn();
    render(<AccountsTable rows={rows} excluded={[]} committedRowIds={[]} onCommitRows={onCommitRows} onEditCell={vi.fn()} onEditHolding={vi.fn()} onDropHolding={vi.fn()} />);
    const roth = screen.getByRole("row", { name: /Schwab Roth IRA/ });
    await userEvent.click(within(roth).getByRole("button", { name: /commit/i }));
    // The second argument is the override box's state, and pinning it here is
    // the point: a plain Commit click must never arrive as an override.
    expect(onCommitRows).toHaveBeenCalledWith(["r2"], { overrideAll: false });
  });

  /**
   * The "Override all fields" box under a matched row's Commit button. It is
   * offered ONLY on a row that will UPDATE an existing account, because on a
   * row that creates one there is nothing to override — a checkbox that
   * cannot change the outcome is worse than no checkbox.
   */
  describe("the override box", () => {
    const matched = [
      { ...(rows as never as Record<string, unknown>[])[0], match: { kind: "exact", existingId: "acct-1" } },
      (rows as never as Record<string, unknown>[])[1],
    ] as never;

    it("is offered on a matched row and withheld from a new one", () => {
      render(<AccountsTable rows={matched} excluded={[]} committedRowIds={[]} onCommitRows={vi.fn()} onEditCell={vi.fn()} onEditHolding={vi.fn()} onDropHolding={vi.fn()} />);
      const updating = screen.getByRole("row", { name: /Schwab Taxable 0707/ });
      const creating = screen.getByRole("row", { name: /Schwab Roth IRA/ });
      expect(within(updating).getByRole("checkbox", { name: /override all fields/i })).toBeInTheDocument();
      expect(within(creating).queryByRole("checkbox", { name: /override all fields/i })).toBeNull();
    });

    it("sends the override only after it is ticked, and only for its own row", async () => {
      const onCommitRows = vi.fn();
      render(<AccountsTable rows={matched} excluded={[]} committedRowIds={[]} onCommitRows={onCommitRows} onEditCell={vi.fn()} onEditHolding={vi.fn()} onDropHolding={vi.fn()} />);
      const updating = screen.getByRole("row", { name: /Schwab Taxable 0707/ });

      // Ticking alone commits nothing — the box is a modifier for the button.
      await userEvent.click(within(updating).getByRole("checkbox", { name: /override all fields/i }));
      expect(onCommitRows).not.toHaveBeenCalled();

      await userEvent.click(within(updating).getByRole("button", { name: /commit/i }));
      expect(onCommitRows).toHaveBeenCalledWith(["r1"], { overrideAll: true });

      // The neighbour was never ticked, so its own Commit stays a plain one.
      const creating = screen.getByRole("row", { name: /Schwab Roth IRA/ });
      await userEvent.click(within(creating).getByRole("button", { name: /commit/i }));
      expect(onCommitRows).toHaveBeenLastCalledWith(["r2"], { overrideAll: false });
    });

    it("is withheld from a row that is already committed", () => {
      render(<AccountsTable rows={matched} excluded={[]} committedRowIds={["r1"]} onCommitRows={vi.fn()} onEditCell={vi.fn()} onEditHolding={vi.fn()} onDropHolding={vi.fn()} />);
      const updating = screen.getByRole("row", { name: /Schwab Taxable 0707/ });
      expect(within(updating).queryByRole("checkbox", { name: /override all fields/i })).toBeNull();
    });
  });

  // `owners[]` is a RECORDED fact — the advisor picked, or the registration
  // line matched — so it resolves to the real name and carries no "Assumed"
  // chip. That absence is the whole signal: it is what tells the advisor this
  // row's owner has been settled and the guessed ones have not.
  it("renders a recorded owner as a real name, unmarked", () => {
    render(<AccountsTable columnsContext={CTX} rows={rows} excluded={[]} committedRowIds={[]} onCommitRows={vi.fn()} onEditCell={vi.fn()} onEditHolding={vi.fn()} onDropHolding={vi.fn()} />);
    const taxable = screen.getByRole("row", { name: /Schwab Taxable 0707/ });
    expect(within(taxable).getByText("Michael Sharesky")).toBeInTheDocument();
    expect(within(taxable).queryByTestId("assumed-chip")).toBeNull();
  });

  // The other half: a row with no recorded owner still gets a real name when
  // the statement's registration line names somebody on the plan — and keeps
  // the chip, because nobody has confirmed it.
  it("resolves an unrecorded registration line to a name, marked as a guess", () => {
    render(<AccountsTable columnsContext={CTX} rows={rows} excluded={[]} committedRowIds={[]} onCommitRows={vi.fn()} onEditCell={vi.fn()} onEditHolding={vi.fn()} onDropHolding={vi.fn()} />);
    const roth = screen.getByRole("row", { name: /Schwab Roth IRA/ });
    expect(within(roth).getByText("Michael Sharesky")).toBeInTheDocument();
    expect(within(roth).getByTestId("assumed-chip")).toBeInTheDocument();
  });

  it("falls back to the registration hint, marked as unconfirmed", () => {
    render(<AccountsTable rows={rows} excluded={[]} committedRowIds={[]} onCommitRows={vi.fn()} onEditCell={vi.fn()} onEditHolding={vi.fn()} onDropHolding={vi.fn()} />);
    const roth = screen.getByRole("row", { name: /Schwab Roth IRA/ });
    const owner = within(roth).getByText(/MICHAEL V SHARESKY ROTH IRA/);
    expect(owner.closest("[data-assumed]")).not.toBeNull();
  });

  it("locks a committed row against re-posting", () => {
    render(<AccountsTable rows={rows} excluded={[]} committedRowIds={["r1"]} onCommitRows={vi.fn()} onEditCell={vi.fn()} onEditHolding={vi.fn()} onDropHolding={vi.fn()} />);
    const taxable = screen.getByRole("row", { name: /Schwab Taxable 0707/ });
    expect(within(taxable).getByRole("button", { name: /committed/i })).toBeDisabled();
  });

  it("shows an excluded rollup with its reason and a restore toggle", async () => {
    const onEditCell = vi.fn();
    const excluded = [{
      row: { __rowId: "r9", name: "All Accounts", value: 21_475.2 },
      decision: { kind: "rollup-excluded", label: "All Accounts", value: 21_475.2, coversCount: 3 },
    }] as never;
    render(<AccountsTable rows={rows} excluded={excluded} committedRowIds={[]} onCommitRows={vi.fn()} onEditCell={onEditCell} onEditHolding={vi.fn()} onDropHolding={vi.fn()} />);
    expect(screen.getByText(/total covering 3 accounts/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /include anyway/i })).toBeInTheDocument();
  });

  it("scrolls the table sideways rather than the page", () => {
    const { container } = render(<AccountsTable rows={rows} excluded={[]} committedRowIds={[]} onCommitRows={vi.fn()} onEditCell={vi.fn()} onEditHolding={vi.fn()} onDropHolding={vi.fn()} />);
    expect(container.querySelector(".overflow-x-auto")).not.toBeNull();
  });
});

/**
 * Task 12, requirement B. The extractor's `owner` guess is no longer a
 * dedupe key, so it is no longer load-bearing for identity — but it IS still
 * decisive at COMMIT: the statement-chat path never seeds `row.owners`, so
 * `commit/accounts.ts` falls through to
 * `synthesizeAccountOwners(tx, accountId, row.owner, family, isRetirement)`
 * and writes ownership straight from the coarse enum. The guess stops
 * mattering only once a human can correct it in one click before committing,
 * which is what this cell is.
 */
describe("accounts table — the Owner cell is editable", () => {
  it("opens an Owner dropdown on a row that has not been committed", async () => {
    render(<AccountsTable rows={rows} excluded={[]} committedRowIds={[]} onCommitRows={vi.fn()} onEditCell={vi.fn()} onEditHolding={vi.fn()} onDropHolding={vi.fn()} />);
    const roth = screen.getByRole("row", { name: /Schwab Roth IRA/ });
    await userEvent.click(within(roth).getByRole("button", { name: /MICHAEL V SHARESKY ROTH IRA/ }));
    expect(within(roth).getByLabelText("Owner")).toBeInTheDocument();
    // The registration name is the evidence the advisor decides on — the one
    // field that stayed stable while the guess moved — so the editor shows it.
    expect(within(roth).getByText(/MICHAEL V SHARESKY ROTH IRA/)).toBeInTheDocument();
  });

  it("writes real ownership, once, when an owner is picked", async () => {
    const onEditCell = vi.fn();
    render(<AccountsTable columnsContext={CTX} rows={rows} excluded={[]} committedRowIds={[]} onCommitRows={vi.fn()} onEditCell={onEditCell} onEditHolding={vi.fn()} onDropHolding={vi.fn()} />);
    const roth = screen.getByRole("row", { name: /Schwab Roth IRA/ });
    await userEvent.click(within(roth).getByRole("button", { name: /MICHAEL V SHARESKY ROTH IRA/ }));
    await userEvent.selectOptions(within(roth).getByLabelText("Owner"), "fm:fm-2");

    // One field, one call. The column is headed "Owner" but the field it writes
    // is `owners[]` — the shape `commit/accounts.ts` persists verbatim — not
    // the coarse enum, which cannot name a child or a trust.
    expect(onEditCell).toHaveBeenCalledTimes(1);
    expect(onEditCell).toHaveBeenCalledWith("r2", "owners", [
      { kind: "family_member", familyMemberId: "fm-2", percent: 1 },
    ]);
  });

  // `entity-table.tsx` computes `canEdit = !!col.edit && !!rowId &&
  // !isCommitted`, so a committed row must render no editor at all —
  // otherwise an advisor edits a row whose account is already written and
  // the correction goes nowhere. The un-committed row in the same table is
  // the positive control: it still offers the editor.
  it("offers no Owner editor on a committed row", async () => {
    render(<AccountsTable rows={rows} excluded={[]} committedRowIds={["r1"]} onCommitRows={vi.fn()} onEditCell={vi.fn()} onEditHolding={vi.fn()} onDropHolding={vi.fn()} />);
    const taxable = screen.getByRole("row", { name: /Schwab Taxable 0707/ });
    expect(within(taxable).queryByRole("button", { name: "Michael V Sharesky" })).toBeNull();
    expect(within(taxable).queryByLabelText("Owner")).toBeNull();

    const roth = screen.getByRole("row", { name: /Schwab Roth IRA/ });
    await userEvent.click(within(roth).getByRole("button", { name: /MICHAEL V SHARESKY ROTH IRA/ }));
    expect(within(roth).getByLabelText("Owner")).toBeInTheDocument();
  });
});

/**
 * Fix round 1, Important 1. Making the Owner cell editable made
 * `entity-table.tsx` wrap its read display in a click-to-edit `<button>` —
 * and on the registration-hint path that display contains `AssumedChip`,
 * which contains `FieldTooltip`, which is itself a `<button>`. Nested
 * interactive controls (WCAG 4.1.2), on exactly the rows whose owner is a
 * guess and so most need correcting.
 *
 * Fixed at the ONE consumer, not in `FieldTooltip` (61 files render it) and
 * not by deleting the badge: the "Assumed" pill is the at-a-glance signal for
 * which owner values are guesses, and an editable cell makes that signal
 * worth more, not less. The chip takes an additive opt-out for its tooltip,
 * `OwnerCell` uses it, and the reason sentence moves to the editor — where
 * the advisor is actually deciding.
 */
describe("accounts table — the Owner cell holds no nested button", () => {
  // The Owner column is the 5th of the seven (Name · Value · Basis · Last 4 ·
  // Owner · Custodian · Account type), pinned in order by the first test in
  // this file — shifted one further right (index 5, not 4) by the Task 5
  // disclosure `<td>` every row now leads with.
  const ownerCellOf = (row: HTMLElement) => within(row).getAllByRole("cell")[5];

  it("renders exactly one button in an editable Owner cell, and keeps the Assumed pill", () => {
    render(<AccountsTable rows={rows} excluded={[]} committedRowIds={[]} onCommitRows={vi.fn()} onEditCell={vi.fn()} onEditHolding={vi.fn()} onDropHolding={vi.fn()} />);
    const roth = screen.getByRole("row", { name: /Schwab Roth IRA/ });
    const cell = ownerCellOf(roth) as HTMLElement;

    // One button: the click-to-edit wrapper. No `Show help` button inside it.
    expect(within(cell).getAllByRole("button")).toHaveLength(1);
    expect(within(cell).queryByRole("button", { name: /show help/i })).toBeNull();
    // The signal itself must survive — this is not a fix by deletion.
    expect(within(cell).getByTestId("assumed-chip")).toBeInTheDocument();
    // And the hint is still marked as unconfirmed by the cell itself.
    expect(within(cell).getByText(/MICHAEL V SHARESKY ROTH IRA/).closest("[data-assumed]")).not.toBeNull();
  });

  it("makes the assumed reason reachable in the editor instead", async () => {
    render(<AccountsTable columnsContext={CTX} rows={rows} excluded={[]} committedRowIds={[]} onCommitRows={vi.fn()} onEditCell={vi.fn()} onEditHolding={vi.fn()} onDropHolding={vi.fn()} />);
    const roth = screen.getByRole("row", { name: /Schwab Roth IRA/ });
    await userEvent.click(within(roth).getByRole("button", { name: /MICHAEL V SHARESKY ROTH IRA/ }));
    expect(within(roth).getByText(/not confirmed/i)).toBeInTheDocument();
  });
});

/**
 * Fix round 2. The browser pass found the Owner dropdown doing nothing
 * visible: `OwnerCell` tested `names`, then `hint`, then `role`, so whenever
 * the statement printed a registration name — essentially always — the hint
 * branch won and the picked role was NEVER rendered. The advisor picks
 * "Co-client", the cell keeps showing the printed name plus "Assumed", and the
 * control reads as dead. This repo has logged that exact failure mode before.
 *
 * The deeper problem the dropdown only exposed: the cell was headlining a
 * string that NEVER COMMITS. In the chat path `row.owners` is never seeded
 * (`matchOwnersFromHint` is wizard-only), so `synthesizeAccountOwners`
 * consumes `row.owner` — the ENUM is the committed value and the registration
 * name is only the evidence for choosing it. So this is a reorder, not a
 * patch: resolved names, then the ROLE as the value, then the name as
 * subordinate context.
 */
describe("accounts table — the Owner cell shows the value that commits", () => {
  // Shifted one further right (index 5, not 4) by the Task 5 disclosure
  // `<td>` every row now leads with — see the note above.
  const ownerCellOf = (row: HTMLElement) => within(row).getAllByRole("cell")[5] as HTMLElement;

  const withRoleAndHint = (owner: "client" | "spouse" | "joint") =>
    [
      { __rowId: "r5", name: "Schwab Roth IRA", value: 22_873.46, accountNumberLast4: "1168",
        custodian: "Charles Schwab", owner, ownerNameHint: "MICHAEL V SHARESKY ROTH IRA" },
    ] as never;

  it("renders the role as the primary value, with the printed name subordinate", () => {
    render(<AccountsTable rows={withRoleAndHint("spouse")} excluded={[]} committedRowIds={[]} onCommitRows={vi.fn()} onEditCell={vi.fn()} onEditHolding={vi.fn()} onDropHolding={vi.fn()} />);
    const cell = ownerCellOf(screen.getByRole("row", { name: /Schwab Roth IRA/ }));

    // Catches the defect exactly: with hint-before-role precedence the role
    // word is absent from the cell altogether.
    expect(within(cell).getByText("Co-client")).toBeInTheDocument();
    // PRIMACY, not just presence — the committed value reads first. Catches a
    // "fix" that appends the role after the name instead of leading with it.
    expect(cell.textContent?.startsWith("Co-client")).toBe(true);

    // The evidence survives as context, still marked unconfirmed, still
    // wearing the pill (Ruling 137) — catches a fix by deletion.
    expect(within(cell).getByText(/MICHAEL V SHARESKY ROTH IRA/).closest("[data-assumed]")).not.toBeNull();
    expect(within(cell).getByTestId("assumed-chip")).toBeInTheDocument();
    // And still exactly one button, so round 1's a11y fix is not undone.
    expect(within(cell).getAllByRole("button")).toHaveLength(1);
  });

  it("changes what the cell displays when owner changes", () => {
    const { rerender } = render(
      <AccountsTable rows={withRoleAndHint("client")} excluded={[]} committedRowIds={[]} onCommitRows={vi.fn()} onEditCell={vi.fn()} onEditHolding={vi.fn()} onDropHolding={vi.fn()} />,
    );
    expect(within(ownerCellOf(screen.getByRole("row", { name: /Schwab Roth IRA/ }))).getByText("Client")).toBeInTheDocument();

    // The whole point of the control: a different `owner` must read
    // differently on screen. Catches any rendering that ignores the field —
    // including the defect, where both renders showed the identical cell.
    rerender(
      <AccountsTable rows={withRoleAndHint("joint")} excluded={[]} committedRowIds={[]} onCommitRows={vi.fn()} onEditCell={vi.fn()} onEditHolding={vi.fn()} onDropHolding={vi.fn()} />,
    );
    const cell = ownerCellOf(screen.getByRole("row", { name: /Schwab Roth IRA/ }));
    expect(within(cell).getByText("Joint")).toBeInTheDocument();
    expect(within(cell).queryByText("Client")).toBeNull();
  });
});

/**
 * Item 1 of Dan's punch list: match an extracted account to one the plan
 * already has, with a manual override and a way out when nothing matched.
 *
 * The stakes are asymmetric and run in both directions, which is what the
 * tests below are shaped around. An `exact` UPDATES an existing account in
 * place — value, basis, custodian, category — so a wrong one overwrites the
 * wrong account. A `new` INSERTs, so a missed match puts a second copy of an
 * account the client already has into the plan and double-counts it.
 */
const MATCH_CANDIDATES = [
  {
    id: "acct-1",
    name: "Schwab Brokerage",
    category: "taxable" as const,
    accountNumberLast4: "0990",
    custodian: "Charles Schwab",
    value: 8_600,
  },
  {
    id: "acct-2",
    name: "Schwab Roth",
    category: "retirement" as const,
    accountNumberLast4: "1168",
    custodian: "Charles Schwab",
    value: 22_800,
  },
];

/** `rows` above is `as never`, which cannot be spread. Same data, usable shape. */
const base = rows as unknown as Record<string, unknown>[];

const table = (over: Record<string, unknown> = {}) => (
  <AccountsTable
    rows={rows}
    excluded={[]}
    committedRowIds={[]}
    onCommitRows={vi.fn()}
    onEditCell={vi.fn()}
    onEditHolding={vi.fn()}
    onDropHolding={vi.fn()}
    matchCandidates={MATCH_CANDIDATES}
    {...over}
  />
);

describe("accounts table — the Match column", () => {
  it("names the existing account an exact match will overwrite", () => {
    const matched = [{ ...base[0], match: { kind: "exact", existingId: "acct-1" } }, rows[1]] as never;
    render(table({ rows: matched }));
    const row = screen.getByRole("row", { name: /Schwab Taxable 0707/ });
    expect(within(row).getByText(/Matched/)).toBeInTheDocument();
    // The NAME, not just the badge: "✓ Matched" alone does not tell an advisor
    // which of four Schwab accounts is about to be rewritten.
    expect(within(row).getByText("Schwab Brokerage")).toBeInTheDocument();
  });

  it("reads as New when nothing on the plan matches", () => {
    render(table());
    const row = screen.getByRole("row", { name: /Schwab Taxable 0707/ });
    expect(within(row).getByText(/New/)).toBeInTheDocument();
  });

  // The override. Both writes matter: `match` is what the commit reads, and
  // `matchLocked` is what stops the next annotation pass re-deriving over the
  // advisor's ruling and silently re-suggesting what they just rejected.
  it("records a picked match as a locked human ruling", async () => {
    const onEditCell = vi.fn();
    render(table({ onEditCell }));
    const row = screen.getByRole("row", { name: /Schwab Taxable 0707/ });
    await userEvent.click(within(row).getByRole("button", { name: /New/ }));
    await userEvent.click(await screen.findByRole("button", { name: /Schwab Roth/ }));
    expect(onEditCell).toHaveBeenCalledWith("r1", "match", { kind: "exact", existingId: "acct-2" });
    expect(onEditCell).toHaveBeenCalledWith("r1", "matchLocked", true);
  });

  it("records a deliberate create-as-new the same way", async () => {
    const onEditCell = vi.fn();
    const fuzzy = [{ ...base[0], match: { kind: "fuzzy", candidates: [{ id: "acct-1", score: 0.6 }] } }, rows[1]] as never;
    render(table({ rows: fuzzy, onEditCell }));
    const row = screen.getByRole("row", { name: /Schwab Taxable 0707/ });
    await userEvent.click(within(row).getByRole("button", { name: /Ambiguous/ }));
    await userEvent.click(await screen.findByRole("button", { name: /Create as new/ }));
    expect(onEditCell).toHaveBeenCalledWith("r1", "match", { kind: "new" });
    expect(onEditCell).toHaveBeenCalledWith("r1", "matchLocked", true);
  });

  // One existing account, at most one imported row. Two rows matched to the
  // same account means two UPDATEs against it — last-wins, and the other
  // row's figures vanish with no warning.
  it("withholds an account another row is already matched to", async () => {
    const openPickerOn = async (rowSet: unknown) => {
      const { unmount } = render(table({ rows: rowSet }));
      const row = screen.getByRole("row", { name: /Schwab Taxable 0707/ });
      await userEvent.click(within(row).getByRole("button", { name: /New/ }));
      const names = within(await screen.findByRole("listbox"))
        .getAllByRole("option")
        .map((o) => o.textContent ?? "");
      unmount();
      return names;
    };

    // Control first — an option list that is empty for the WRONG reason would
    // make the assertion below pass without the filter doing anything. Both
    // accounts are on offer when nobody has claimed either.
    expect(await openPickerOn(rows)).toHaveLength(2);

    const claimed = [rows[0], { ...base[1], match: { kind: "exact", existingId: "acct-2" } }] as never;
    const offered = await openPickerOn(claimed);
    expect(offered).toHaveLength(1);
    expect(offered[0]).toContain("Schwab Brokerage");
  });

  // Whenever the matcher cannot settle a row the advisor settles it by hand,
  // and they do it by recognising the owner and the balance. A picker that
  // shows neither is why a row stays Ambiguous.
  it("shows each candidate's owner and value", async () => {
    const withOwners = MATCH_CANDIDATES.map((c, i) => ({
      ...c,
      ownerNames: i === 0 ? ["Michael Sharesky"] : ["Michael Sharesky", "Jennifer Sharesky"],
    }));
    render(table({ matchCandidates: withOwners }));
    const row = screen.getByRole("row", { name: /Schwab Taxable 0707/ });
    await userEvent.click(within(row).getByRole("button", { name: /New/ }));
    const options = within(await screen.findByRole("listbox")).getAllByRole("option");

    expect(options[0].textContent).toContain("Michael Sharesky");
    expect(options[0].textContent).toContain("$8,600");
    expect(options[1].textContent).toContain("Michael Sharesky & Jennifer Sharesky");
    expect(options[1].textContent).toContain("$22,800");
  });

  it("offers no picker on a committed row", () => {
    render(table({ committedRowIds: ["r1"] }));
    const row = screen.getByRole("row", { name: /Schwab Taxable 0707/ });
    expect(within(row).queryByRole("button", { name: /New/ })).toBeNull();
    expect(within(row).getByText(/New/)).toBeInTheDocument();
  });
});

/**
 * The hole this closes: `commitAccounts` SKIPS a `fuzzy` row. Before this,
 * its Commit button POSTed, the route returned 200, the row wrote NOTHING,
 * and the button then read "Committed" — a success reported for work that
 * never happened.
 */
describe("accounts table — an unresolved match blocks Commit", () => {
  const fuzzyRows = [
    { ...base[0], match: { kind: "fuzzy", candidates: [{ id: "acct-1", score: 0.62 }] } },
    rows[1],
  ] as never;

  it("disables Commit on an ambiguous row and says why", () => {
    render(table({ rows: fuzzyRows }));
    const row = screen.getByRole("row", { name: /Schwab Taxable 0707/ });
    expect(within(row).getByRole("button", { name: /^Commit$/ })).toBeDisabled();
    expect(within(row).getByText(/Pick a match first/i)).toBeInTheDocument();
  });

  it("never POSTs an ambiguous row", async () => {
    const onCommitRows = vi.fn();
    render(table({ rows: fuzzyRows, onCommitRows }));
    const row = screen.getByRole("row", { name: /Schwab Taxable 0707/ });
    await userEvent.click(within(row).getByRole("button", { name: /^Commit$/ }));
    expect(onCommitRows).not.toHaveBeenCalled();
  });

  // The other rows must stay committable — one unresolved row cannot hold the
  // whole statement hostage.
  it("leaves a resolvable row alone", () => {
    render(table({ rows: fuzzyRows }));
    const roth = screen.getByRole("row", { name: /Schwab Roth IRA/ });
    expect(within(roth).getByRole("button", { name: /^Commit$/ })).toBeEnabled();
    expect(within(roth).queryByText(/Pick a match first/i)).toBeNull();
  });
});

/**
 * The figures under the table. Asserted with `toHaveTextContent` rather than
 * `getByText`, because every figure is split across a `.tabular` span — the
 * brand puts numbers in mono — so `getByText("2 accounts")` matches no single
 * text node (recorded trap).
 *
 * The shape here is the real one from import 93ff2c60: a statement balance, a
 * paystub that names the direct-deposit account but prints no balance (so the
 * extractor wrote 0), and a beneficiary .jpg with no value at all.
 */
describe("accounts table — totals", () => {
  const props = {
    excluded: [],
    committedRowIds: [],
    onCommitRows: vi.fn(),
    onEditCell: vi.fn(),
    onEditHolding: vi.fn(),
    onDropHolding: vi.fn(),
  };

  // The whole tfoot: the figures row plus, when a column could not cover
  // every row, the footnote row beneath it.
  const footer = () => {
    const el = document.querySelector("tfoot");
    if (!el) throw new Error("no tfoot rendered");
    return el as HTMLElement;
  };

  // Kills: dropping the footer entirely, and counting rows without summing
  // them.
  it("counts the accounts and sums their values", () => {
    render(<AccountsTable rows={rows} {...props} />);
    expect(footer()).toHaveTextContent("2 accounts");
    // 8,618.60 + 22,873.46
    expect(footer()).toHaveTextContent("$31,492");
  });

  // Kills: silently summing 3 of 4 rows under a count of 4. The disclosure is
  // the whole point of question (b) — without it the figure reads as covering
  // every account above it.
  it("discloses a row whose value is missing, and leaves it out of the sum", () => {
    const withGap = [
      { __rowId: "r1", name: "401(k) Savings Plan", value: 361_262.23, custodian: "John Hancock" },
      { __rowId: "r2", name: "Checking x0479", value: 0, category: "cash" },
      { __rowId: "r3", name: "Savings", value: 0, category: "cash" },
      { __rowId: "r4", name: "401k Savings Plan", category: "retirement" },
    ] as never;
    render(<AccountsTable rows={withGap} {...props} />);
    expect(footer()).toHaveTextContent("4 accounts");
    expect(footer()).toHaveTextContent("$361,262");
    // The ONE row with no value at all — not the two real $0 readings, which
    // sum to zero correctly and already show "$0" in their own cells.
    expect(footer()).toHaveTextContent("Value excludes 1 account without a figure.");
  });

  // Kills: reporting a real zero as missing, which would overstate the gap on
  // every household with a paystub in the upload.
  it("says nothing about a gap when every row carries a figure", () => {
    render(<AccountsTable rows={rows} {...props} />);
    expect(footer()).not.toHaveTextContent(/without a figure/);
  });

  // Kills: totalling every `money` column. Basis is a different question, and
  // 3,919.45 + 10,010.17 = 13,930 must not appear.
  it("totals Value and not Basis", () => {
    render(<AccountsTable rows={rows} {...props} />);
    expect(footer()).not.toHaveTextContent("$13,930");
  });

  // Dan's scope decision: the footer totals exactly what the table SHOWS, so a
  // committed row keeps counting — it is still on screen.
  it("keeps counting a row after it is committed", () => {
    render(<AccountsTable rows={rows} {...props} committedRowIds={["r1"]} />);
    expect(footer()).toHaveTextContent("2 accounts");
    expect(footer()).toHaveTextContent("$31,492");
  });

  // The other half of that rule: a rollup `detectRollups` set aside is "a total
  // covering N accounts already listed", so summing it would double count the
  // household. It is not a row, so it is not in the figure.
  it("ignores a rollup held in the excluded list", () => {
    const excluded = [
      {
        row: { __rowId: "x1", name: "Total Plan Analysis", value: 1_000_000 },
        decision: { kind: "rollup-excluded", coversCount: 2 },
        reason: "a total covering 2 accounts already listed",
      },
    ] as never;
    render(<AccountsTable rows={rows} {...props} excluded={excluded} />);
    expect(footer()).toHaveTextContent("2 accounts");
    expect(footer()).toHaveTextContent("$31,492");
    expect(footer()).not.toHaveTextContent("$1,031,492");
  });

  // A table with no rows states no total: the surface shows its own
  // "No accounts found" card instead, and "0 accounts · $0" under an empty
  // table is a figure nobody computed.
  it("renders no totals row for an empty table", () => {
    render(<AccountsTable rows={[] as never} {...props} />);
    // Counted, not text-matched: with no rows, a "no total here" text
    // assertion would pass for the wrong reason. No tfoot at all is the fact.
    expect(document.querySelector("tfoot")).toBeNull();
    expect(screen.getAllByRole("row")).toHaveLength(1);
  });

  // The positive control for the assertion above: header + 2 body + the
  // figures row, and NO footnote row because both rows carry a value.
  // Without this, "no tfoot" proves nothing about whether one is ever emitted.
  it("adds one footer row when it totals, and no footnote when nothing is missing", () => {
    render(<AccountsTable rows={rows} {...props} />);
    expect(document.querySelector("tfoot")).not.toBeNull();
    expect(screen.getAllByRole("row")).toHaveLength(4);
  });

  // The footnote is a SECOND footer row, and only when a figure is missing.
  it("adds a footnote row only when a column cannot cover every row", () => {
    const withGap = [
      { __rowId: "r1", name: "401(k) Savings Plan", value: 361_262.23 },
      { __rowId: "r2", name: "401k Savings Plan" },
    ] as never;
    render(<AccountsTable rows={withGap} {...props} />);
    // header + 2 body + figures + footnote
    expect(screen.getAllByRole("row")).toHaveLength(5);
  });
});

/**
 * ── Final review I5 ─────────────────────────────────────────────────────
 *
 * `splitMortgageEscrow` deliberately synthesizes its property with NO value —
 * "a mortgage statement never says what the home is worth, and a 0 would
 * render as a worthless house". `commit/accounts.ts:186` then writes an
 * absent value as `"0"`, so the house lands on the balance sheet worth
 * nothing with a real mortgage against it, and the projection grows a $0
 * asset forever. The Value cell is read-only on this surface, so committing
 * the $0 was the path of least resistance.
 */
describe("accounts table withholds Commit for a property with no value", () => {
  const props = {
    excluded: [],
    committedRowIds: [],
    onCommitRows: vi.fn(),
    onEditCell: vi.fn(),
    onEditHolding: vi.fn(),
    onDropHolding: vi.fn(),
  };
  const synthesized = {
    __rowId: "account:synthesized:5304-hudson-avenue",
    name: "5304 Hudson Avenue",
    category: "real_estate",
    subType: "primary_residence",
    propertyAddress: "5304 Hudson Avenue",
  };

  it("disables Commit and says what to do about it", () => {
    render(<AccountsTable rows={[synthesized] as never} {...props} />);
    expect(screen.getByRole("button", { name: /commit/i })).toBeDisabled();
    expect(screen.getByText(/enter a value first/i)).toBeInTheDocument();
  });

  it("allows Commit once the value is set", () => {
    render(<AccountsTable rows={[{ ...synthesized, value: 850_000 }] as never} {...props} />);
    expect(screen.getByRole("button", { name: /commit/i })).toBeEnabled();
  });

  /**
   * A value of ZERO is an assertion, not a hole: an advisor who typed 0 meant
   * 0. `value == null` is the test, not falsiness.
   */
  it("allows Commit for a property explicitly valued at zero", () => {
    render(<AccountsTable rows={[{ ...synthesized, value: 0 }] as never} {...props} />);
    expect(screen.getByRole("button", { name: /commit/i })).toBeEnabled();
  });

  /**
   * Scoped to real estate. Every other category commits fine without a value
   * — an account whose balance the statement did not print is an ordinary
   * extraction outcome, and blocking those would strand real imports.
   */
  it("does not block a value-less account of any other category", () => {
    render(
      <AccountsTable
        rows={[{ __rowId: "r9", name: "Roth IRA", category: "retirement" }] as never}
        {...props}
      />,
    );
    expect(screen.getByRole("button", { name: /commit/i })).toBeEnabled();
  });
});

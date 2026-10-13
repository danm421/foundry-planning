// @vitest-environment jsdom
// src/components/fact-finder/__tests__/page-view.test.tsx
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { applyOps, FactFinderOpError, type ClientOp } from "@/lib/fact-finder/ops";
import { findSection, type FFPage } from "@/lib/fact-finder/schema";
import { emptyFactFinderState } from "@/lib/fact-finder/state";
import type { FactFinderState, FFCell, FFCellValue, FFRemoved, FFRow } from "@/lib/fact-finder/types";
import { PageView } from "../page-view";

const AT = "2026-10-13T12:00:00.000Z";
const CTX = { by: "advisor" as const, now: AT, newId: () => "new-id" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const typed = (value: FFCellValue): FFCell => ({ value, by: "advisor", pinned: true });
const row = (id: string, values: Record<string, FFCellValue>): FFRow => ({
  id,
  cells: Object.fromEntries(Object.entries(values).map(([columnId, value]) => [columnId, typed(value)])),
  sourceFileIds: [],
});
const removed = (sectionId: string, r: FFRow): FFRemoved => ({ sectionId, row: r, reason: "Removed", by: "advisor", at: AT });

function stateWith(sections: Record<string, FFRow[]>, extra: Partial<FactFinderState> = {}): FactFinderState {
  const s = emptyFactFinderState();
  return { ...s, ...extra, sections: { ...s.sections, ...sections } };
}

const joint = row("c1", { accountName: "Joint Checking" });
const savings = row("c2", { accountName: "Savings", currentValue: 5000 });

/**
 * One page the way the screen renders it: onApply runs the real ops (as
 * useFactFinder's apply does — false on a refused edit) and the page
 * re-renders from the new state.
 */
function renderPage(page: FFPage, initial: FactFinderState) {
  const applied = vi.fn<(ops: ClientOp[]) => void>();
  function Harness() {
    const [state, setState] = useState(initial);
    const onApply = (ops: ClientOp[]) => {
      applied(ops);
      try {
        setState(applyOps(state, ops, CTX));
        return true;
      } catch (e) {
        if (e instanceof FactFinderOpError) return false;
        throw e;
      }
    };
    return <PageView page={page} state={state} onApply={onApply} fileName={() => undefined} />;
  }
  render(<Harness />);
  return { applied };
}

const region = (name: string) => screen.getByRole("region", { name });
const rowOf = (header: HTMLElement) => header.closest("tr") as HTMLElement;

describe("PageView — one component per layout", () => {
  it("list: the columns go across and each entry is a row, named by its row header", () => {
    renderPage("accounts", stateWith({ cash: [joint, savings] }));
    const table = screen.getByRole("table", { name: "Cash Accounts" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(
      findSection("cash")!.columns.map((c) => c.label),
    );
    expect(within(table).getAllByRole("rowheader")).toHaveLength(2);
    const savingsRow = rowOf(within(table).getByRole("rowheader", { name: "Savings" }));
    expect(within(savingsRow).getByRole("textbox", { name: "Account name" })).toHaveValue("Savings");
    expect(within(savingsRow).getByRole("textbox", { name: "Current value" })).toHaveValue("5,000");
  });

  it("fixed rows: the row labels go down; nothing to add, remove or merge", () => {
    const s = emptyFactFinderState();
    const [client, coClient] = s.sections.people;
    renderPage("household", stateWith({ people: [{ ...client, cells: { firstName: typed("Mark") } }, coClient] }));
    const card = region("Client & Co-client");
    const table = within(card).getByRole("table", { name: "Client & Co-client" });
    expect(within(table).getAllByRole("rowheader").map((h) => h.textContent)).toEqual(["Client", "Co-client"]);
    const clientRow = rowOf(within(table).getByRole("rowheader", { name: "Client" }));
    expect(within(clientRow).getByRole("textbox", { name: "First name" })).toHaveValue("Mark");
    expect(within(card).queryByRole("button", { name: /^(Add row|Remove)/ })).toBeNull();
    expect(within(card).queryByRole("combobox", { name: /^Merge/ })).toBeNull();
  });

  it("transposed: the fields go down and each policy is a column", () => {
    const term = row("l1", { policyName: "Term Life", carrier: "Banner" });
    const whole = row("l2", { policyName: "Whole Life", carrier: "Northwestern" });
    renderPage("insurance", stateWith({ life: [term, whole] }));
    const table = screen.getByRole("table", { name: "Life Insurance" });
    expect(within(table).getByRole("columnheader", { name: "Term Life" })).toHaveTextContent("Policy 1");
    expect(within(table).getByRole("columnheader", { name: "Whole Life" })).toHaveTextContent("Policy 2");
    expect(within(table).getAllByRole("rowheader").map((h) => h.textContent)).toEqual(
      findSection("life")!.columns.map((c) => c.label),
    );
    const carrierRow = rowOf(within(table).getByRole("rowheader", { name: "Carrier" }));
    expect(
      within(carrierRow)
        .getAllByRole("textbox", { name: "Carrier" })
        .map((input) => (input as HTMLInputElement).value),
    ).toEqual(["Banner", "Northwestern"]);
  });

  it("notes: one text box; nothing to add, remove or merge", () => {
    renderPage("insurance", emptyFactFinderState());
    const card = region("Group / employer coverage & notes");
    expect(within(card).getByRole("textbox", { name: "Notes" })).toBeInTheDocument();
    expect(within(card).queryByRole("table")).toBeNull();
    expect(within(card).queryAllByRole("button")).toHaveLength(0);
  });
});

describe("PageView — rows and the Removed tray", () => {
  it("an empty list or transposed section folds to its header; Add row adds a row with a new id each time", async () => {
    const { applied } = renderPage("accounts", emptyFactFinderState());
    const card = region("Cash Accounts");
    expect(within(card).queryByRole("table")).toBeNull();

    await userEvent.click(within(card).getByRole("button", { name: "Add row to Cash Accounts" }));
    expect(applied).toHaveBeenLastCalledWith([{ op: "addRow", sectionId: "cash", rowId: expect.stringMatching(UUID) }]);
    const table = within(card).getByRole("table", { name: "Cash Accounts" });
    expect(within(table).getByRole("rowheader", { name: "Cash Accounts row" })).toBeInTheDocument();

    await userEvent.click(within(card).getByRole("button", { name: "Add row to Cash Accounts" }));
    expect(within(table).getAllByRole("rowheader")).toHaveLength(2);
    const [first, second] = applied.mock.calls.map(([ops]) => (ops[0] as { rowId: string }).rowId);
    expect(first).not.toBe(second);
  });

  it("an empty transposed section folds the same way", () => {
    renderPage("insurance", emptyFactFinderState());
    const card = region("Life Insurance");
    expect(within(card).queryByRole("table")).toBeNull();
    expect(within(card).getByRole("button", { name: "Add row to Life Insurance" })).toBeInTheDocument();
  });

  it("Remove sends a row to the Removed tray at the bottom of the page; Restore puts it back", async () => {
    const { applied } = renderPage("accounts", stateWith({ cash: [joint, savings] }));
    expect(screen.queryByRole("region", { name: "Removed" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Remove Savings" }));
    expect(applied).toHaveBeenLastCalledWith([{ op: "removeRow", sectionId: "cash", rowId: "c2" }]);
    expect(screen.queryByRole("rowheader", { name: "Savings" })).toBeNull();
    const tray = region("Removed");
    expect(screen.getAllByRole("region").at(-1)).toBe(tray);
    expect(within(tray).getByText("Savings")).toBeInTheDocument();
    expect(within(tray).getByText("Cash Accounts · Removed")).toBeInTheDocument();

    await userEvent.click(within(tray).getByRole("button", { name: "Restore Savings" }));
    expect(applied).toHaveBeenLastCalledWith([{ op: "restoreRow", rowId: "c2" }]);
    expect(screen.getByRole("rowheader", { name: "Savings" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Removed" })).toBeNull();
  });

  it("Merge folds a row into another row of its section; the merged row waits in the tray", async () => {
    const { applied } = renderPage("accounts", stateWith({ cash: [joint, savings] }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Merge Savings into…" }), "1. Joint Checking");
    expect(applied).toHaveBeenLastCalledWith([{ op: "mergeRows", sectionId: "cash", keepRowId: "c1", dropRowId: "c2" }]);
    expect(screen.queryByRole("rowheader", { name: "Savings" })).toBeNull();
    const jointRow = rowOf(screen.getByRole("rowheader", { name: "Joint Checking" }));
    expect(within(jointRow).getByRole("textbox", { name: "Current value" })).toHaveValue("5,000");
    expect(within(region("Removed")).getByText("Cash Accounts · Merged into Joint Checking")).toBeInTheDocument();
  });

  it("a section's only row can be removed but has nothing to merge into", () => {
    renderPage("accounts", stateWith({ cash: [joint] }));
    expect(screen.getByRole("button", { name: "Remove Joint Checking" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /^Merge/ })).toBeNull();
  });

  it("a policy is removed or merged from the head of its column", async () => {
    const term = row("l1", { policyName: "Term Life" });
    const whole = row("l2", { policyName: "Whole Life" });
    const { applied } = renderPage("insurance", stateWith({ life: [term, whole] }));
    const table = screen.getByRole("table", { name: "Life Insurance" });
    expect(within(table).getByRole("button", { name: "Remove Term Life" })).toBeInTheDocument();
    await userEvent.selectOptions(within(table).getByRole("combobox", { name: "Merge Whole Life into…" }), "1. Term Life");
    expect(applied).toHaveBeenLastCalledWith([{ op: "mergeRows", sectionId: "life", keepRowId: "l1", dropRowId: "l2" }]);
    expect(within(table).queryByRole("columnheader", { name: "Whole Life" })).toBeNull();
  });

  it("the Removed tray lists only the rows of this page's sections", () => {
    const loan = row("d1", { loanName: "Ally Auto Loan" });
    renderPage("accounts", stateWith({ cash: [joint] }, { removed: [removed("cash", savings), removed("liab", loan)] }));
    const tray = region("Removed");
    expect(within(tray).getAllByRole("listitem")).toHaveLength(1);
    expect(within(tray).getByText("Savings")).toBeInTheDocument();
    expect(within(tray).queryByText("Ally Auto Loan")).toBeNull();
  });

  it("highlights the cells the last chat reply changed, and only those", () => {
    const after: FFRow = { ...joint, cells: { ...joint.cells, currentValue: { value: 7000, by: "chat", pinned: true } } };
    const at = (r: FFRow) => ({ where: "section" as const, sectionId: "cash", index: 0, row: r });
    renderPage(
      "accounts",
      stateWith(
        { cash: [after] },
        {
          transcript: [
            { id: "u1", role: "user", text: "Joint checking has $7,000", at: AT },
            { id: "a1", role: "assistant", text: "Done.", at: AT },
          ],
          undo: { a1: [{ kind: "row", rowId: "c1", before: at(joint), after: at(after) }] },
        },
      ),
    );
    const jointRow = rowOf(screen.getByRole("rowheader", { name: "Joint Checking" }));
    expect(within(jointRow).getByRole("textbox", { name: "Current value" })).toHaveAccessibleDescription(
      "Changed by the last chat reply",
    );
    expect(within(jointRow).getByRole("textbox", { name: "Account name" })).toHaveAccessibleDescription("");
  });
});

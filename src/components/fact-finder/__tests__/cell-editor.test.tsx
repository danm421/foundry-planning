// @vitest-environment jsdom
// src/components/fact-finder/__tests__/cell-editor.test.tsx
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { applyOps, FactFinderOpError, type ClientOp } from "@/lib/fact-finder/ops";
import { findColumn } from "@/lib/fact-finder/schema";
import { emptyFactFinderState } from "@/lib/fact-finder/state";
import type { FactFinderState, FFCell, FFCellValue } from "@/lib/fact-finder/types";
import { CellEditor } from "../cell-editor";

const CTX = { by: "advisor" as const, now: "2026-10-13T12:00:00.000Z", newId: () => "new-id" };

const doc = (value: FFCellValue, extra: Partial<FFCell> = {}): FFCell => ({
  value,
  by: "document",
  confidence: 0.95,
  source: { fileId: "f1", page: 2 },
  ...extra,
});
const typed = (value: FFCellValue): FFCell => ({ value, by: "advisor", pinned: true });

/** A fact finder whose section holds just this row. */
function stateWith(sectionId: string, rowId: string, cells: Record<string, FFCell>): FactFinderState {
  const s = emptyFactFinderState();
  return { ...s, sections: { ...s.sections, [sectionId]: [{ id: rowId, cells, sourceFileIds: ["f1"] }] } };
}

interface CellOptions {
  highlighted?: boolean;
  fileName?: (fileId: string) => string | undefined;
}

/**
 * One cell the way the screen renders it: onApply runs the real ops (as
 * useFactFinder's apply does — false on a refused edit) and the cell
 * re-renders from the new state.
 */
function renderCell(
  sectionId: string,
  rowId: string,
  columnId: string,
  cells: Record<string, FFCell>,
  { highlighted = false, fileName = () => undefined }: CellOptions = {},
) {
  const applied = vi.fn<(ops: ClientOp[], ok: boolean) => void>();
  const column = findColumn(sectionId, columnId);
  if (!column) throw new Error(`no column ${sectionId}.${columnId}`);
  function Harness() {
    const [state, setState] = useState(() => stateWith(sectionId, rowId, cells));
    const onApply = (ops: ClientOp[]) => {
      let ok = true;
      try {
        setState(applyOps(state, ops, CTX));
      } catch (e) {
        if (!(e instanceof FactFinderOpError)) throw e;
        ok = false;
      }
      applied(ops, ok);
      return ok;
    };
    const cell = state.sections[sectionId]?.find((r) => r.id === rowId)?.cells[columnId];
    return (
      <CellEditor
        sectionId={sectionId}
        rowId={rowId}
        column={column!}
        cell={cell}
        onApply={onApply}
        highlighted={highlighted}
        fileName={fileName}
      />
    );
  }
  const view = render(<Harness />);
  return { applied, ...view };
}

const setCell = (sectionId: string, rowId: string, columnId: string, value: unknown): ClientOp => ({
  op: "setCell",
  sectionId,
  rowId,
  columnId,
  value,
});
const clearCell = (sectionId: string, rowId: string, columnId: string): ClientOp => ({
  op: "clearCell",
  sectionId,
  rowId,
  columnId,
});

describe("CellEditor — one editor per column kind", () => {
  it("text: commits the typed text on Enter and keeps focus", async () => {
    const { applied } = renderCell("cash", "r1", "accountName", { accountName: doc("Joint Checking") });
    const input = screen.getByRole("textbox", { name: "Account name" });
    expect(input).toHaveValue("Joint Checking");
    await userEvent.clear(input);
    await userEvent.type(input, "Everyday Checking{Enter}");
    expect(applied).toHaveBeenCalledTimes(1);
    expect(applied).toHaveBeenLastCalledWith([setCell("cash", "r1", "accountName", "Everyday Checking")], true);
    expect(input).toHaveValue("Everyday Checking");
    expect(input).toHaveFocus();
  });

  it("money: a compact dollar input that commits on blur", async () => {
    const { applied } = renderCell("cash", "r1", "currentValue", { currentValue: doc(412000) });
    const input = screen.getByRole("textbox", { name: "Current value" });
    expect(input).toHaveValue("412,000");
    expect(screen.getByText("$")).toBeInTheDocument();
    expect(input).toHaveClass("h-8", "tabular");
    await userEvent.clear(input);
    await userEvent.type(input, "1500.5");
    await userEvent.tab();
    expect(applied).toHaveBeenLastCalledWith([setCell("cash", "r1", "currentValue", "1500.5")], true);
    expect(input).toHaveValue("1,500.5");
  });

  it("percent: a compact percent input", async () => {
    const { applied } = renderCell("cash", "r1", "interestRate", { interestRate: doc(4.25) });
    const input = screen.getByRole("textbox", { name: "Interest rate %" });
    expect(input).toHaveValue("4.25");
    expect(screen.getByText("%")).toBeInTheDocument();
    await userEvent.clear(input);
    await userEvent.type(input, "4.5{Enter}");
    expect(applied).toHaveBeenLastCalledWith([setCell("cash", "r1", "interestRate", "4.5")], true);
    expect(input).toHaveValue("4.5");
  });

  it.each([
    ["equity", "r1", "sharesGranted", "Shares granted", 1200, "decimal"],
    ["people", "people:Client", "retirementAge", "Retirement age", 65, "numeric"],
    ["salary", "salary:Client", "startYear", "Start year", 2024, "numeric"],
  ])("%s.%s: a text input with a number keypad", async (sectionId, rowId, columnId, label, value, mode) => {
    const { applied } = renderCell(sectionId, rowId, columnId, { [columnId]: doc(value) });
    const input = screen.getByRole("textbox", { name: label });
    expect(input).toHaveAttribute("inputmode", mode);
    expect(input).toHaveValue(String(value));
    await userEvent.clear(input);
    await userEvent.type(input, "2031{Enter}");
    expect(applied).toHaveBeenLastCalledWith([setCell(sectionId, rowId, columnId, "2031")], true);
    expect(input).toHaveValue("2031");
  });

  it("date: a native date input that commits on blur", () => {
    const { applied } = renderCell("people", "people:Client", "dateOfBirth", { dateOfBirth: doc("1962-04-01") });
    const input = screen.getByLabelText("Date of birth");
    expect(input).toHaveAttribute("type", "date");
    expect(input).toHaveValue("1962-04-01");
    fireEvent.change(input, { target: { value: "1963-05-02" } });
    expect(applied).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(applied).toHaveBeenLastCalledWith([setCell("people", "people:Client", "dateOfBirth", "1963-05-02")], true);
    expect(input).toHaveValue("1963-05-02");
  });

  it("month and year: a native month input that commits on Enter", () => {
    const { applied } = renderCell("liab", "r1", "balanceAsOf", { balanceAsOf: doc("2026-06") });
    const input = screen.getByLabelText("Balance as of");
    expect(input).toHaveAttribute("type", "month");
    expect(input).toHaveValue("2026-06");
    fireEvent.change(input, { target: { value: "2026-09" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(applied).toHaveBeenLastCalledWith([setCell("liab", "r1", "balanceAsOf", "2026-09")], true);
    expect(input).toHaveValue("2026-09");
  });

  it("choice: a select of the schema's options that commits on pick; the blank option clears", async () => {
    const { applied } = renderCell("cash", "r1", "accountType", { accountType: doc("Checking") });
    const select = screen.getByRole("combobox", { name: "Account type" });
    expect(select).toHaveDisplayValue("Checking");
    expect(
      Array.from((select as HTMLSelectElement).options).map((o) => o.text),
    ).toEqual(["—", "Checking", "Savings", "CD", "Money market", "Other"]);
    await userEvent.selectOptions(select, "Savings");
    expect(applied).toHaveBeenLastCalledWith([setCell("cash", "r1", "accountType", "Savings")], true);
    expect(select).toHaveDisplayValue("Savings");
    await userEvent.selectOptions(select, "—");
    expect(applied).toHaveBeenLastCalledWith([clearCell("cash", "r1", "accountType")], true);
    expect(select).toHaveDisplayValue("—");
  });

  it("choice: a document value that isn't one of the options shows as written, asking to pick one", async () => {
    const { applied } = renderCell("cash", "r1", "accountType", {
      accountType: doc("Brokerage acct", { issue: "notAnOption" }),
    });
    const select = screen.getByRole("combobox", { name: "Account type" });
    expect(select).toHaveDisplayValue("Brokerage acct — pick one");
    expect(screen.getByRole("option", { name: "Brokerage acct — pick one" })).toBeDisabled();
    expect(screen.getByText("Check this")).toBeInTheDocument();
    await userEvent.selectOptions(select, "Savings");
    expect(applied).toHaveBeenLastCalledWith([setCell("cash", "r1", "accountType", "Savings")], true);
    expect(screen.queryByRole("option", { name: /pick one/ })).toBeNull();
    expect(screen.queryByText("Check this")).toBeNull();
  });

  it("check: a checkbox — checking sets it, unchecking clears it; no ×", async () => {
    const { applied } = renderCell("family", "r1", "domesticPartner", {});
    const box = screen.getByRole("checkbox", { name: "Domestic partner" });
    expect(box).not.toBeChecked();
    await userEvent.click(box);
    expect(applied).toHaveBeenLastCalledWith([setCell("family", "r1", "domesticPartner", true)], true);
    expect(box).toBeChecked();
    expect(screen.queryByRole("button", { name: /^Clear/ })).toBeNull();
    await userEvent.click(box);
    expect(applied).toHaveBeenLastCalledWith([clearCell("family", "r1", "domesticPartner")], true);
    expect(box).not.toBeChecked();
  });

  it("notes: a textarea where Enter starts a new line; it commits on blur", async () => {
    const { applied } = renderCell("family", "r1", "notes", {});
    const area = screen.getByRole("textbox", { name: "Notes" });
    expect(area.tagName).toBe("TEXTAREA");
    await userEvent.type(area, "Lives abroad{Enter}Visits in June");
    expect(applied).not.toHaveBeenCalled();
    await userEvent.tab();
    expect(applied).toHaveBeenLastCalledWith([setCell("family", "r1", "notes", "Lives abroad\nVisits in June")], true);
  });
});

describe("CellEditor — commit and revert", () => {
  it("an emptied input commits clearCell", async () => {
    const { applied } = renderCell("cash", "r1", "accountName", { accountName: doc("Joint Checking") });
    const input = screen.getByRole("textbox", { name: "Account name" });
    await userEvent.clear(input);
    await userEvent.tab();
    expect(applied).toHaveBeenLastCalledWith([clearCell("cash", "r1", "accountName")], true);
    expect(input).toHaveValue("");
  });

  it("Escape puts the stored value back and applies nothing", async () => {
    const { applied } = renderCell("cash", "r1", "accountName", { accountName: doc("Joint Checking") });
    const input = screen.getByRole("textbox", { name: "Account name" });
    await userEvent.type(input, " extra{Escape}");
    expect(input).toHaveValue("Joint Checking");
    await userEvent.tab();
    expect(applied).not.toHaveBeenCalled();
  });

  it("leaving a cell without changing it applies nothing", async () => {
    const { applied } = renderCell("cash", "r1", "currentValue", { currentValue: doc(412000) });
    const input = screen.getByRole("textbox", { name: "Current value" });
    await userEvent.click(input);
    await userEvent.tab();
    await userEvent.clear(input);
    await userEvent.type(input, "412000");
    await userEvent.tab();
    expect(applied).not.toHaveBeenCalled();
  });

  it("RF3: `abc` in a number cell is refused — onApply returns false and the input shows the old value", async () => {
    const { applied } = renderCell("people", "people:Client", "retirementAge", { retirementAge: typed(65) });
    const input = screen.getByRole("textbox", { name: "Retirement age" });
    await userEvent.clear(input);
    await userEvent.type(input, "abc{Enter}");
    expect(applied).toHaveBeenCalledTimes(1);
    expect(applied).toHaveBeenLastCalledWith([setCell("people", "people:Client", "retirementAge", "abc")], false);
    expect(input).toHaveValue("65");
  });

  it("RF3: `abc` never reaches a money cell — the dollar input drops letters, so nothing is applied", async () => {
    const { applied } = renderCell("cash", "r1", "currentValue", { currentValue: typed(1000) });
    const input = screen.getByRole("textbox", { name: "Current value" });
    await userEvent.type(input, "abc");
    expect(input).toHaveValue("1,000");
    await userEvent.tab();
    expect(applied).not.toHaveBeenCalled();
  });

  it("RF3: a refused money edit (a lone minus sign) reverts to the old value", async () => {
    const { applied } = renderCell("cash", "r1", "currentValue", { currentValue: typed(1000) });
    const input = screen.getByRole("textbox", { name: "Current value" });
    await userEvent.clear(input);
    await userEvent.type(input, "-");
    expect(input).toHaveValue("-");
    await userEvent.tab();
    expect(applied).toHaveBeenLastCalledWith([setCell("cash", "r1", "currentValue", "-")], false);
    expect(input).toHaveValue("1,000");
  });

  it("a document value that wouldn't parse shows as written in a plain input until it's corrected", async () => {
    const { applied } = renderCell("cash", "r1", "currentValue", {
      currentValue: doc("about 400k", { issue: "unparsed", confidence: 0.4 }),
    });
    const input = screen.getByRole("textbox", { name: "Current value" });
    expect(input).toHaveValue("about 400k");
    expect(screen.queryByText("$")).toBeNull();
    expect(screen.getByText("Check this")).toBeInTheDocument();
    await userEvent.clear(input);
    await userEvent.type(input, "400000{Enter}");
    expect(applied).toHaveBeenLastCalledWith([setCell("cash", "r1", "currentValue", "400000")], true);
    expect(screen.getByRole("textbox", { name: "Current value" })).toHaveValue("400,000");
    expect(screen.getByText("$")).toBeInTheDocument();
    expect(screen.queryByText("Check this")).toBeNull();
  });
});

describe("CellEditor — clear, source, Check this, highlight", () => {
  it("× clears the cell and pins it empty; a blank cell has no ×", async () => {
    const { applied } = renderCell("cash", "r1", "accountName", { accountName: doc("Joint Checking") });
    await userEvent.click(screen.getByRole("button", { name: "Clear Account name" }));
    expect(applied).toHaveBeenLastCalledWith([clearCell("cash", "r1", "accountName")], true);
    expect(screen.getByRole("textbox", { name: "Account name" })).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Clear Account name" })).toBeNull();
  });

  it("shows where a document value came from: file, page, what it said and how sure the reading was", async () => {
    renderCell(
      "cash",
      "r1",
      "currentValue",
      { currentValue: doc(412000, { confidence: 0.62, source: { fileId: "f1", page: 3, snippet: "Total value $412,000.00" } }) },
      { fileName: (id) => (id === "f1" ? "Q3 statement.pdf" : undefined) },
    );
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent("From Q3 statement.pdf, page 3");
    expect(tip).toHaveTextContent("“Total value $412,000.00”");
    expect(tip).toHaveTextContent("Confidence 62%");
    expect(screen.getByRole("textbox", { name: "Current value" })).toHaveAccessibleDescription(
      expect.stringContaining("From Q3 statement.pdf, page 3"),
    );
  });

  it("says when the source document has since been removed", () => {
    renderCell("cash", "r1", "accountName", { accountName: doc("Joint Checking", { source: { fileId: "gone" } }) });
    expect(screen.getByRole("tooltip")).toHaveTextContent("From a removed document");
  });

  it("a typed value has no source", () => {
    renderCell("cash", "r1", "accountName", { accountName: typed("Joint Checking") });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it.each([
    ["a document value below 0.7", doc(5000, { confidence: 0.69 }), true],
    ["a document value at 0.7", doc(5000, { confidence: 0.7 }), false],
    ["a typed value", typed(5000), false],
  ])("Check this: %s", (_name, cell, shown) => {
    renderCell("cash", "r1", "currentValue", { currentValue: cell });
    expect(screen.queryByText("Check this") !== null).toBe(shown);
  });

  it("a cell the last chat reply changed says so", () => {
    const { unmount } = renderCell("cash", "r1", "accountName", { accountName: typed("Joint Checking") }, { highlighted: true });
    expect(screen.getByRole("textbox", { name: "Account name" })).toHaveAccessibleDescription(
      "Changed by the last chat reply",
    );
    unmount();
    renderCell("cash", "r1", "accountName", { accountName: typed("Joint Checking") });
    expect(screen.queryByText("Changed by the last chat reply")).toBeNull();
  });
});

// @vitest-environment jsdom
// src/components/fact-finder/__tests__/worksheet-pane.test.tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { WorksheetPane } from "../worksheet-pane";
import { emptyFactFinderState } from "@/lib/fact-finder/state";
import type { FactFinderState, FFRow } from "@/lib/fact-finder/types";
import type { WsTable } from "@/lib/fact-finder/worksheet/types";

afterEach(cleanup);

const ira: FFRow = {
  id: "r1",
  sourceFileIds: ["f1"],
  cells: {
    accountName: { value: "Joint IRA", by: "document", confidence: 0.99 },
    currentValue: { value: 431050, by: "document", confidence: 0.99 },
  },
};

function stateWith(tables: WsTable[], row: FFRow = ira): FactFinderState {
  const s = emptyFactFinderState();
  s.sections.retirement = [row];
  s.worksheet = { tables, composedFileIds: [] };
  return s;
}

const accounts: WsTable = {
  id: "t1",
  title: "Accounts",
  note: "From the Schwab statement",
  columns: [
    { id: "name", header: "Account", bind: { kind: "cell", columnId: "accountName" } },
    { id: "value", header: "Value", bind: { kind: "cell", columnId: "currentValue" } },
  ],
  rows: [{ id: "w1", cells: {}, ref: { rowId: "r1" }, source: { fileId: "f1", page: 2 } }],
};
const people: WsTable = {
  id: "t2",
  title: "People",
  columns: [{ id: "n", header: "Name" }],
  rows: [{ id: "w2", cells: { n: "Mark" } }],
};
const fileName = (id: string) => (id === "f1" ? "schwab.pdf" : undefined);

describe("WorksheetPane", () => {
  it("shows the empty message", () => {
    render(<WorksheetPane state={stateWith([])} fileName={fileName} busy={false} />);
    expect(screen.getByText("Upload documents or ask for a table — the tables the AI builds show up here.")).toBeInTheDocument();
  });

  it("renders a bound value from staging", () => {
    render(<WorksheetPane state={stateWith([accounts])} fileName={fileName} busy={false} />);
    expect(screen.getByText("Accounts")).toBeInTheDocument();
    expect(screen.getByText("From the Schwab statement")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "$431,050" })).toBeInTheDocument();
    expect(screen.getByText("schwab.pdf p.2")).toBeInTheDocument();
  });

  it("right-aligns a column only when every filled cell is a figure", () => {
    render(<WorksheetPane state={stateWith([accounts])} fileName={fileName} busy={false} />);
    expect(screen.getByRole("cell", { name: "$431,050" }).className).toMatch(/text-right/);
    expect(screen.getByRole("columnheader", { name: "Value" }).className).toMatch(/text-right/);
    expect(screen.getByRole("cell", { name: /Joint IRA/ }).className).not.toMatch(/text-right/);
  });

  it("Copy writes the table's markdown", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<WorksheetPane state={stateWith([accounts])} fileName={fileName} busy={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith("| Account | Value |\n| --- | --- |\n| Joint IRA | $431,050 |");
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("Match to plan asks for that table", () => {
    const onMatch = vi.fn();
    render(<WorksheetPane state={stateWith([accounts, people])} fileName={fileName} busy={false} onMatch={onMatch} />);
    const card = screen.getByRole("heading", { name: "People" }).closest("section")!;
    fireEvent.click(within(card).getByRole("button", { name: "Match to plan" }));
    expect(onMatch).toHaveBeenCalledWith("t2");
  });

  it("Match all asks with no table", () => {
    const onMatch = vi.fn();
    render(<WorksheetPane state={stateWith([accounts, people])} fileName={fileName} busy={false} onMatch={onMatch} />);
    fireEvent.click(screen.getByRole("button", { name: "Match all to plan" }));
    expect(onMatch).toHaveBeenCalledWith();
  });

  it("hides Match all with one table, and disables Match buttons while busy", () => {
    const { rerender } = render(<WorksheetPane state={stateWith([accounts])} fileName={fileName} busy={false} onMatch={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Match all to plan" })).toBeNull();
    rerender(<WorksheetPane state={stateWith([accounts, people])} fileName={fileName} busy onMatch={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Match all to plan" })).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "Match to plan" })[0]).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "Copy" })[0]).toBeEnabled();
  });

  it("marks a row in the plan and a value to check", () => {
    const s = stateWith([accounts], { ...ira, cells: { ...ira.cells, currentValue: { value: 431050, by: "document", confidence: 0.2 } } });
    s.applied = [{ lineId: "r1/account", rowId: "r1", target: "account", recordId: "a1", label: "Joint IRA", at: "2026-10-26T00:00:00.000Z" }];
    render(<WorksheetPane state={s} fileName={fileName} busy={false} />);
    expect(screen.getByText("In plan")).toBeInTheDocument();
    expect(screen.getByLabelText("Check this value")).toBeInTheDocument();
  });

  it("read-only without onMatch shows no Match buttons", () => {
    render(<WorksheetPane state={stateWith([accounts, people])} fileName={fileName} busy={false} />);
    expect(screen.queryByRole("button", { name: /Match/ })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Copy" })).toHaveLength(2);
  });

  it("shows no source chip when the file is unknown", () => {
    render(<WorksheetPane state={stateWith([{ ...accounts, rows: [{ ...accounts.rows[0], source: { fileId: "zz", page: 1 } }] }])} fileName={fileName} busy={false} />);
    expect(screen.queryByText(/p\.1/)).toBeNull();
  });
});

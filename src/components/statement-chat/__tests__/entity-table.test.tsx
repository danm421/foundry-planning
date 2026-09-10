// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EntityTable, { type ColumnSpec } from "../entity-table";

/**
 * A deliberately NON-account shape (Phase 2 proof / controller amendment
 * "WORTH ADDING"). If account assumptions ever leak back into
 * entity-table.tsx — a hardcoded "category"/"custodian" field, an
 * accounts-only formatter — this is the test that goes red first.
 */
interface Widget {
  __rowId?: string;
  label: string;
  qty: number;
}

const columns: ColumnSpec<Widget>[] = [
  { key: "label", header: "Label", kind: "string" },
  { key: "qty", header: "Quantity", kind: "number" },
];

const rows: Widget[] = [{ __rowId: "w1", label: "Widget A", qty: 5 }];

describe("entity table (generic)", () => {
  it("renders a two-column spec of a non-account shape", () => {
    render(
      <EntityTable
        rows={rows}
        columns={columns}
        excluded={[]}
        committedRowIds={[]}
        onCommitRows={vi.fn()}
        onEditCell={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Label",
      "Quantity",
      "",
    ]);
    expect(screen.getByText("Widget A")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  // Task 10 review, Important 6: `year` must not group digits with a
  // thousands separator the way `money`/`number` do — a calendar year like
  // 2026 is not a quantity.
  it("renders a year column without a thousands separator", () => {
    const yearColumns: ColumnSpec<Widget & { started: number }>[] = [
      { key: "label", header: "Label", kind: "string" },
      { key: "started", header: "Started", kind: "year" },
    ];
    render(
      <EntityTable
        rows={[{ __rowId: "w1", label: "Widget A", qty: 5, started: 2026 }]}
        columns={yearColumns}
        excluded={[]}
        committedRowIds={[]}
        onCommitRows={vi.fn()}
        onEditCell={vi.fn()}
      />,
    );
    expect(screen.getByText("2026")).toBeInTheDocument();
    expect(screen.queryByText("2,026")).not.toBeInTheDocument();
  });

  // Task 10 review, Important 3: a column that collapses more than one real
  // field (`fields`) must fan its edit's patch out into one `onEditCell`
  // call per named field — never a single call keyed by the column's own
  // (synthetic, non-payload) `key`.
  it("fans a multi-field column's edit out into one onEditCell call per field", async () => {
    const onEditCell = vi.fn();
    const multiColumns: ColumnSpec<Widget>[] = [
      { key: "label", header: "Label", kind: "string" },
      {
        key: "combo",
        header: "Combo",
        kind: "string",
        fields: ["a", "b"],
        edit: (_row, onChange) =>
          <button type="button" onClick={() => onChange({ a: 1, b: 2 })}>apply</button>,
      },
    ];
    render(
      <EntityTable
        rows={rows}
        columns={multiColumns}
        excluded={[]}
        committedRowIds={[]}
        onCommitRows={vi.fn()}
        onEditCell={onEditCell}
      />,
    );
    // The "combo" cell has no value on this row, so its default display is
    // the em dash — clicking it (a column with `edit` renders its display as
    // a button) opens the editor.
    await userEvent.click(screen.getByRole("button", { name: "—" }));
    await userEvent.click(screen.getByRole("button", { name: "apply" }));

    expect(onEditCell).toHaveBeenCalledWith("w1", "a", 1);
    expect(onEditCell).toHaveBeenCalledWith("w1", "b", 2);
    expect(onEditCell).not.toHaveBeenCalledWith("w1", "combo", expect.anything());
  });

  describe("restore (CRITICAL — Include anyway must never silently commit)", () => {
    const excluded = [{ row: { __rowId: "x1", label: "Excluded widget", qty: 1 }, reason: "a duplicate" }];

    it("disables Include anyway and never posts a commit when no onRestore is given", async () => {
      const onCommitRows = vi.fn();
      render(
        <EntityTable
          rows={rows}
          columns={columns}
          excluded={excluded}
          committedRowIds={[]}
          onCommitRows={onCommitRows}
          onEditCell={vi.fn()}
        />,
      );
      const button = screen.getByRole("button", { name: /include anyway/i });
      expect(button).toBeDisabled();
      await userEvent.click(button);
      expect(onCommitRows).not.toHaveBeenCalled();
    });

    it("calls onRestore, not onCommitRows, when onRestore is given", async () => {
      const onCommitRows = vi.fn();
      const onRestore = vi.fn();
      render(
        <EntityTable
          rows={rows}
          columns={columns}
          excluded={excluded}
          committedRowIds={[]}
          onCommitRows={onCommitRows}
          onEditCell={vi.fn()}
          onRestore={onRestore}
        />,
      );
      const button = screen.getByRole("button", { name: /include anyway/i });
      expect(button).not.toBeDisabled();
      await userEvent.click(button);
      expect(onRestore).toHaveBeenCalledWith(excluded[0].row);
      expect(onCommitRows).not.toHaveBeenCalled();
    });
  });

  describe("commit in-flight guard and failure handling (Important 7)", () => {
    it("does not double-post a commit clicked twice before the promise settles", async () => {
      let resolveCommit: () => void = () => {};
      const onCommitRows = vi.fn(
        () => new Promise<void>((resolve) => { resolveCommit = resolve; }),
      );
      render(
        <EntityTable
          rows={rows}
          columns={columns}
          excluded={[]}
          committedRowIds={[]}
          onCommitRows={onCommitRows}
          onEditCell={vi.fn()}
        />,
      );
      const button = screen.getByRole("button", { name: /commit/i });
      await userEvent.click(button);
      await userEvent.click(button);
      expect(onCommitRows).toHaveBeenCalledTimes(1);
      resolveCommit();
    });

    it("shows an error and re-enables Commit when the request fails", async () => {
      const onCommitRows = vi.fn().mockRejectedValue(new Error("Network error"));
      render(
        <EntityTable
          rows={rows}
          columns={columns}
          excluded={[]}
          committedRowIds={[]}
          onCommitRows={onCommitRows}
          onEditCell={vi.fn()}
        />,
      );
      await userEvent.click(screen.getByRole("button", { name: /commit/i }));
      expect(await screen.findByText("Network error")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^commit$/i })).not.toBeDisabled();
    });
  });
});

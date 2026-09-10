// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
});

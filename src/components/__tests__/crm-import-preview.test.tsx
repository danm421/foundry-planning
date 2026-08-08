// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CrmImportPreview, resolve } from "../crm-import-preview";
import type { PreviewResult, DuplicateMatch } from "../crm-import-wizard";
import type { ParsedRow } from "@/lib/crm/import/rows";

function row(rowIndex: number, name: string, errors: ParsedRow["errors"] = []): ParsedRow {
  return {
    rowIndex,
    household: { name, nameIsCustom: false, status: "prospect" },
    primary: { role: "primary", firstName: "Jane", lastName: "Smith" },
    errors,
    warnings: [],
  } as ParsedRow;
}

function preview(over: Partial<PreviewResult> = {}): PreviewResult {
  return {
    rows: [row(0, "Jane Smith")],
    duplicates: [],
    partialDedupCorpus: false,
    truncated: false,
    ...over,
  };
}

describe("CrmImportPreview", () => {
  it("counts an unflagged row as one to create", () => {
    render(<CrmImportPreview preview={preview()} choices={{}} onChange={vi.fn()} />);
    expect(screen.getByTestId("stat-create")).toHaveTextContent("1");
  });

  it("excludes an errored row from the create count", () => {
    const p = preview({
      rows: [row(0, "Jane Smith"), row(1, "", [{ field: "primaryLast", message: "required" }])],
    });
    render(<CrmImportPreview preview={p} choices={{}} onChange={vi.fn()} />);
    expect(screen.getByTestId("stat-create")).toHaveTextContent("1");
    expect(screen.getByTestId("stat-blocked")).toHaveTextContent("1");
  });

  it("defaults a duplicate row to skip", () => {
    const p = preview({
      duplicates: [{ rowIndex: 0, matches: [{ id: "hh-1", name: "Jane Smith", score: 100 }] }],
    });
    render(<CrmImportPreview preview={p} choices={{}} onChange={vi.fn()} />);
    expect(screen.getByTestId("stat-skip")).toHaveTextContent("1");
  });

  it("emits an explicit create choice when the advisor overrides a duplicate", () => {
    const onChange = vi.fn();
    const p = preview({
      duplicates: [{ rowIndex: 0, matches: [{ id: "hh-1", name: "Jane Smith", score: 100 }] }],
    });
    render(<CrmImportPreview preview={p} choices={{}} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(/create new/i));
    expect(onChange).toHaveBeenCalledWith({ 0: "create" });
  });

  it("warns when the file was truncated", () => {
    render(
      <CrmImportPreview preview={preview({ truncated: true })} choices={{}} onChange={vi.fn()} />,
    );
    expect(screen.getByText(/first 1,000 rows/i)).toBeInTheDocument();
  });

  // Additive — Task 11 fix round 1, item 3. The blocked-count tile above is
  // computed independently of what actually renders in <tbody>; a mutation
  // that filtered blocked rows out of the table left that test green. This
  // pins the row itself, by the row-number identity the review required.
  it("renders a blocked row in the table, not just in the blocked-count tile", () => {
    const p = preview({
      rows: [row(0, "Jane Smith"), row(1, "", [{ field: "primaryLast", message: "required" }])],
    });
    render(<CrmImportPreview preview={p} choices={{}} onChange={vi.fn()} />);
    const blockedRow = screen.getByText(/row 2/i).closest("tr");
    expect(blockedRow).not.toBeNull();
    expect(blockedRow).toHaveTextContent(/won't import/i);
  });

  it("shows no truncation banner when the file was not truncated", () => {
    render(
      <CrmImportPreview preview={preview({ truncated: false })} choices={{}} onChange={vi.fn()} />,
    );
    expect(screen.queryByText(/first 1,000 rows/i)).not.toBeInTheDocument();
  });

  it("preserves another row's existing choice when overriding a duplicate", () => {
    const onChange = vi.fn();
    const p = preview({
      rows: [row(0, "Jane Smith"), row(1, "John Doe")],
      duplicates: [
        { rowIndex: 0, matches: [{ id: "hh-1", name: "Jane Smith", score: 100 }] },
        { rowIndex: 1, matches: [{ id: "hh-2", name: "John Doe", score: 90 }] },
      ],
    });
    render(<CrmImportPreview preview={p} choices={{ 1: "hh-2" }} onChange={onChange} />);
    const [firstCreateNew] = screen.getAllByLabelText(/create new/i);
    fireEvent.click(firstCreateNew);
    expect(onChange).toHaveBeenCalledWith({ 0: "create", 1: "hh-2" });
  });
});

// Additive — Task 11 fix round 1, item 1. `resolve` now the only place the
// create/skip/blocked precedence is spelled out (the wizard's
// `buildDecisions` calls it rather than re-deriving it), so it is the only
// tested half of that logic; pin all four branches directly.
describe("resolve", () => {
  const matches: DuplicateMatch[] = [
    { id: "hh-1", name: "Jane Smith", score: 100 },
    { id: "hh-2", name: "Jane S.", score: 80 },
  ];

  it("blocks a row even when a choice was made for it", () => {
    const r = row(0, "Jane Smith", [{ field: "primaryLast", message: "required" }]);
    expect(resolve(r, matches, { 0: "create" })).toEqual({ kind: "blocked" });
  });

  it('creates on an explicit "create" choice', () => {
    const r = row(0, "Jane Smith");
    expect(resolve(r, matches, { 0: "create" })).toEqual({ kind: "create" });
  });

  it("skips on the chosen household id when the choice isn't \"create\"", () => {
    const r = row(0, "Jane Smith");
    expect(resolve(r, matches, { 0: "hh-2" })).toEqual({ kind: "skip", householdId: "hh-2" });
  });

  it("defaults to skip on the top match when there's no choice", () => {
    const r = row(0, "Jane Smith");
    expect(resolve(r, matches, {})).toEqual({ kind: "skip", householdId: "hh-1" });
  });

  it("defaults to create when there's no choice and no matches", () => {
    const r = row(0, "Jane Smith");
    expect(resolve(r, undefined, {})).toEqual({ kind: "create" });
  });
});

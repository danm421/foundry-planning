// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CrmImportPreview } from "../crm-import-preview";
import type { PreviewResult } from "../crm-import-wizard";
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
});

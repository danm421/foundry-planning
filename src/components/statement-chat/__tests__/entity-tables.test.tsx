// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import EntityTables from "../entity-tables";
import type { CandidateRow } from "@/lib/entity-extraction/types";

function row(entityId: string, rowId: string, values: Record<string, unknown>, extra: Partial<CandidateRow> = {}): CandidateRow {
  return {
    entityId,
    rowId,
    values: Object.entries(values).map(([key, value]) => ({ key, value, snippet: "x", confidence: 0.9 })),
    missingRequired: [],
    rowConfidence: 0.9,
    ...extra,
  };
}

const rows = {
  life_insurance_policy: [row("life_insurance_policy", "l1", { name: "Term Life 20", faceValue: 500000 })],
  disability_policy: [row("disability_policy", "d1", { name: "Group LTD", carrier: "Unum" })],
};

const props = { rows, committedRowIds: [], onCommitRows: vi.fn(), onEditCell: vi.fn() };

describe("EntityTables", () => {
  it("renders one table per entity, titled with the entity label", () => {
    render(<EntityTables {...props} />);
    expect(screen.getByRole("table", { name: /life insurance policy/i })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: /disability policy/i })).toBeInTheDocument();
  });

  it("orders tables by the Details sidebar, Net Worth before Insurance", () => {
    render(<EntityTables {...props} />);
    const tables = screen.getAllByRole("table").map((t) => t.getAttribute("aria-label"));
    expect(tables.indexOf("Disability policy")).toBeLessThan(tables.indexOf("Life insurance policy"));
  });

  it("renders nothing for an entity with no rows", () => {
    render(<EntityTables {...props} rows={{ life_insurance_policy: rows.life_insurance_policy }} />);
    expect(screen.queryByRole("table", { name: /disability/i })).not.toBeInTheDocument();
  });

  it("blocks commit on a row missing a required field and names it", () => {
    const blocked = { life_insurance_policy: [row("life_insurance_policy", "l1", { name: "Term Life 20" }, { missingRequired: ["faceValue"] })] };
    render(<EntityTables {...props} rows={blocked} />);
    const target = screen.getByRole("row", { name: /Term Life 20/ });
    expect(within(target).getByRole("button", { name: /commit/i })).toBeDisabled();
    expect(within(target).getByText(/death benefit/i)).toBeInTheDocument();
  });

  it("marks a low-confidence cell for review without pre-selecting discard", () => {
    const shaky = { life_insurance_policy: [row("life_insurance_policy", "l1", { name: "Term Life 20", faceValue: 500000 }, { rowConfidence: 0.4 })] };
    render(<EntityTables {...props} rows={shaky} />);
    const target = screen.getByRole("row", { name: /Term Life 20/ });
    expect(within(target).getByTestId("needs-review")).toBeInTheDocument();
    expect(within(target).getByRole("button", { name: /commit/i })).not.toBeDisabled();
  });

  it("says a matched row will update rather than create", () => {
    const matched = { life_insurance_policy: [row("life_insurance_policy", "l1", { name: "Term Life 20", faceValue: 1 }, { match: { kind: "exact", existingId: "p1" } })] };
    render(<EntityTables {...props} rows={matched} />);
    expect(within(screen.getByRole("row", { name: /Term Life 20/ })).getByText(/update/i)).toBeInTheDocument();
  });
});

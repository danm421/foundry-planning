// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  // Real map fixtures, not two rows on the same tab (Task 12 review,
  // Important 3): both original fixtures were `tab: "insurance"`, so the
  // assertion was decided entirely by the label tie-break and passed even
  // with the tab comparator deleted outright. "account" is `tab: "net-worth"`
  // and "transfer" is on `tab: "techniques"`, which `TAB_ORDER` never lists —
  // pinning BOTH contracts: net-worth sorts before insurance, and an unlisted
  // tab sorts LAST rather than first.
  it("orders tables by the Details sidebar — net-worth before insurance, and an unlisted tab last", () => {
    const mixed = {
      account: [row("account", "a1", { name: "Test Account" })],
      life_insurance_policy: rows.life_insurance_policy,
      transfer: [row("transfer", "t1", { name: "Transfer 1" })],
    };
    render(<EntityTables {...props} rows={mixed} />);
    const tables = screen.getAllByRole("table").map((t) => t.getAttribute("aria-label"));
    expect(tables.indexOf("Account")).toBeLessThan(tables.indexOf("Life insurance policy"));
    expect(tables.indexOf("Transfer")).toBe(tables.length - 1);
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

  // Negative cases (Task 12 review, Important 5): the two positive tests
  // above pass even against a hardcoded `{ needsReview: true, action:
  // "Update" }`. A clean, unmatched row must show NEITHER the review marker
  // NOR "Update" — it reads as a plain new row.
  it("leaves a clean, unmatched row unmarked and reads it as a new record", () => {
    const clean = { life_insurance_policy: rows.life_insurance_policy };
    render(<EntityTables {...props} rows={clean} />);
    const target = screen.getByRole("row", { name: /Term Life 20/ });
    expect(within(target).queryByTestId("needs-review")).not.toBeInTheDocument();
    expect(within(target).getByText("Add")).toBeInTheDocument();
  });

  // Critical 1: an unresolved `fuzzy` match (a candidate LIST, no chosen
  // record) must block the commit AND must never read "Update" — there is no
  // picked record to update.
  it("blocks commit on an unresolved fuzzy match and does not promise an update", () => {
    const fuzzy = {
      life_insurance_policy: [
        row(
          "life_insurance_policy",
          "l1",
          { name: "Term Life 20", faceValue: 500000 },
          { match: { kind: "fuzzy", candidates: [{ id: "p1", score: 0.6 }] } },
        ),
      ],
    };
    render(<EntityTables {...props} rows={fuzzy} />);
    const target = screen.getByRole("row", { name: /Term Life 20/ });
    expect(within(target).getByRole("button", { name: /commit/i })).toBeDisabled();
    expect(within(target).queryByText(/update/i)).not.toBeInTheDocument();
  });

  // Important 2: the brief requires fields past the column cap to be
  // reachable through `entity-table.tsx`'s existing `expand` disclosure —
  // for `life_insurance_policy` that is 14 of 22 fields with no way to see
  // them at all otherwise. "Premium payment years" is the first field past
  // the 8-column cap (5 required + cashValue/costBasis/premiumAmount).
  it("reveals the fields past the column cap through the row disclosure", async () => {
    render(<EntityTables {...props} rows={{ life_insurance_policy: rows.life_insurance_policy }} />);
    const target = screen.getByRole("row", { name: /Term Life 20/ });
    expect(screen.queryByText("Premium payment years")).not.toBeInTheDocument();
    await userEvent.click(within(target).getByRole("button", { name: /show/i }));
    expect(screen.getByText("Premium payment years")).toBeInTheDocument();
  });

  // The other half: an entity with nothing past the cap gets no disclosure
  // button at all — `entity-table.tsx` renders one only when `expand`
  // returns non-null for a row, and `medicare_coverage` (a real map entity)
  // has just 7 askable fields, none past the cap.
  it("gives an entity with nothing past the column cap no disclosure button", () => {
    const noOverflow = { medicare_coverage: [row("medicare_coverage", "m1", { owner: "client" })] };
    render(<EntityTables {...props} rows={noOverflow} />);
    const table = screen.getByRole("table", { name: /medicare/i });
    expect(within(table).queryByRole("button", { name: /show/i })).not.toBeInTheDocument();
  });
});

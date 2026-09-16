// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HouseholdDiffTable from "../household-diff-table";
import { buildHouseholdDiff, type HouseholdDiffRow } from "../household-diff";
import { findEntity } from "@/domain/forge/detail-fields";
import type { CandidateRow } from "@/lib/entity-extraction/types";

const entity = findEntity("client_household")!;

const extracted = {
  entityId: "client_household",
  rowId: "f:client_household:0",
  missingRequired: [],
  rowConfidence: 0.9,
  values: [
    { key: "firstName", value: "Jonathan", snippet: "Jonathan A. Smith", confidence: 0.95 },
    { key: "lastName", value: "Smith", snippet: "Jonathan A. Smith", confidence: 0.95 },
    { key: "dateOfBirth", value: "1968-03-14", snippet: "DOB 3/14/1968", confidence: 0.9 },
    { key: "mobile", value: "(215) 555-0147", snippet: "Mobile (215) 555-0147", confidence: 0.9 },
  ],
} as unknown as CandidateRow;

const onRecord = { firstName: "John", lastName: "Smith", dateOfBirth: "1968-03-04", mobile: null };

/**
 * The rows the REAL producer emits, not a hand-written fixture. A table
 * asserted against a shape `buildHouseholdDiff` cannot actually emit would go
 * green while the screen rendered nothing — so the two halves of this task are
 * pinned to each other here: `rows[0]` is First Name, and Date of Birth is the
 * horizon-moving row because `buildHouseholdDiff` said so, not because this
 * file asserted it into being.
 */
const rows: HouseholdDiffRow[] = buildHouseholdDiff({ entity, extracted, onRecord });

describe("household diff table", () => {
  it("renders a row per disagreement with both values", () => {
    render(<HouseholdDiffTable rows={rows} onCommit={vi.fn()} />);
    const row = screen.getByRole("row", { name: /First Name/ });
    expect(row).toHaveTextContent("John");
    expect(row).toHaveTextContent("Jonathan");
  });

  it("warns before a horizon-moving field can be accepted", () => {
    render(<HouseholdDiffTable rows={rows} onCommit={vi.fn()} />);
    expect(screen.getByRole("row", { name: /Date of Birth/ })).toHaveTextContent(/plan horizon/i);
  });

  it("commits only the checked fields", async () => {
    const onCommit = vi.fn();
    render(<HouseholdDiffTable rows={rows} onCommit={onCommit} />);
    await userEvent.click(screen.getByRole("checkbox", { name: /First Name/ }));
    await userEvent.click(screen.getByRole("button", { name: /Update household/ }));
    expect(onCommit).toHaveBeenCalledWith(["firstName"]);
  });

  it("renders nothing when the document agrees with the record", () => {
    const { container } = render(<HouseholdDiffTable rows={[]} onCommit={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("blocks a flagged value from being accepted", () => {
    render(<HouseholdDiffTable rows={[{ ...rows[0], issue: "coercion" }]} onCommit={vi.fn()} />);
    expect(screen.getByRole("checkbox", { name: /First Name/ })).toBeDisabled();
  });
});

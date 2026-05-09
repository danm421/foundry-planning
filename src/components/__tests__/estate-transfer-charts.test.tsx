// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { EstateTransferCharts } from "../estate-transfer-charts";
import type { RecipientTotal } from "@/lib/estate/transfer-report";

const make = (
  key: string,
  label: string,
  recipientKind: RecipientTotal["recipientKind"],
  fromFirstDeath: number,
  fromSecondDeath: number,
): RecipientTotal => ({
  key,
  recipientLabel: label,
  recipientKind,
  fromFirstDeath,
  fromSecondDeath,
  total: fromFirstDeath + fromSecondDeath,
});

const fixture: RecipientTotal[] = [
  make("spouse|s1", "Sarah", "spouse", 1_500_000, 0),
  make("family|c1", "Charlie (son)", "family_member", 0, 800_000),
  make("family|c2", "Diana (daughter)", "family_member", 0, 800_000),
  make("ext|red-cross", "Red Cross", "external_beneficiary", 0, 100_000),
  make("entity|family-trust", "Family Trust", "entity", 0, 200_000),
];

describe("EstateTransferCharts", () => {
  it("renders both chart canvases for a populated input", () => {
    const { container } = render(<EstateTransferCharts totals={fixture} />);
    const canvases = container.querySelectorAll("canvas");
    expect(canvases.length).toBe(2);
  });

  it("renders nothing for an empty input", () => {
    const { container } = render(<EstateTransferCharts totals={[]} />);
    expect(container.querySelector("canvas")).toBeNull();
  });

  it("pins spouse first regardless of total ordering", () => {
    // family member with the largest total comes first by default sort, but
    // spouse must still be pinned first inside the panel.
    const totals: RecipientTotal[] = [
      make("family|big", "Big Heir", "family_member", 0, 10_000_000),
      make("spouse|s1", "Sarah", "spouse", 100_000, 0),
    ];
    const { container } = render(<EstateTransferCharts totals={totals} />);
    // The legend strip in the distribution bar renders recipient names in
    // panel-sort order; assert the first label is the spouse.
    const labels = Array.from(container.querySelectorAll("li span.text-gray-200"));
    expect(labels[0]?.textContent).toBe("Sarah");
  });
});

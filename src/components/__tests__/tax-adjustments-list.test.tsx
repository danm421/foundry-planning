// @vitest-environment jsdom
/**
 * TaxAdjustmentsList — the current-year total shown here is display-only
 * (the engine does the real, per-year fold), but it is also the first thing
 * an advisor checks against their own mental math. Two ways it lies:
 *
 *  - Summing a row that starts or ends outside the current year (the engine
 *    only counts a row within its [startYear, endYear] window).
 *  - Clamping a negative row (income the plan over-counts, entered as a
 *    negative `annualAmount`) to zero instead of letting it subtract — the
 *    whole point of a signed row is that it can pull the total down.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TaxAdjustmentsList } from "../tax-adjustments-list";
import type { IncomeTaxType } from "@/engine/tax-adjustments";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/clients/client-123",
}));

interface Row {
  id: string;
  taxType: IncomeTaxType;
  name: string | null;
  owner: "client" | "spouse" | "joint";
  annualAmount: number;
  growthRate: number;
  startYear: number;
  endYear: number;
  startYearRef: string | null;
  endYearRef: string | null;
  withheldMode: "none" | "amount" | "percent";
  withheldValue: number;
}

function row(overrides: Partial<Row>): Row {
  return {
    id: "row-1",
    taxType: "ordinary_income",
    name: "Test row",
    owner: "joint",
    annualAmount: 10_000,
    growthRate: 0,
    startYear: 2026,
    endYear: 2026,
    startYearRef: null,
    endYearRef: null,
    withheldMode: "none",
    withheldValue: 0,
    ...overrides,
  };
}

// ── Test 1: a row outside the current year is excluded from the total ─────

describe("TaxAdjustmentsList — current-year total window", () => {
  it("excludes a row whose window does not cover the current year", () => {
    render(
      <TaxAdjustmentsList
        clientId="client-123"
        currentYear={2026}
        rows={[
          row({ id: "in-window", annualAmount: 10_000, startYear: 2026, endYear: 2026 }),
          row({ id: "future-only", annualAmount: 50_000, startYear: 2030, endYear: 2035 }),
        ]}
      />,
    );

    // Scoped to the total row itself — the in-window row's own "$10,000"
    // Amount cell would otherwise collide with an unscoped text query.
    const totalRow = screen.getByText("Total for 2026").closest("div")!;
    // Only the in-window row's $10,000 — not $60,000 — proves the future row
    // was excluded rather than summed in.
    expect(totalRow).toHaveTextContent("$10,000");
    expect(totalRow).not.toHaveTextContent("$60,000");
  });
});

// ── Test 2: a negative row subtracts from the total, never clamped ────────

describe("TaxAdjustmentsList — signed total", () => {
  it("lets a negative row subtract from the total instead of clamping at zero", () => {
    render(
      <TaxAdjustmentsList
        clientId="client-123"
        currentYear={2026}
        rows={[
          row({ id: "positive", annualAmount: 10_000, startYear: 2026, endYear: 2026 }),
          row({ id: "negative", annualAmount: -3_000, startYear: 2026, endYear: 2026 }),
        ]}
      />,
    );

    // 10,000 - 3,000 = 7,000. A clamp-at-zero bug on the negative row alone
    // (or on the total) would instead show $10,000 or $13,000.
    const totalRow = screen.getByText("Total for 2026").closest("div")!;
    expect(totalRow).toHaveTextContent("$7,000");
    expect(totalRow).not.toHaveTextContent("$10,000");
    expect(totalRow).not.toHaveTextContent("$13,000");
  });
});

// ── Test 3: the "Tax paid" cell — em-dash for none, a dollar figure for amount ─

describe("TaxAdjustmentsList — Tax paid column", () => {
  it("renders an em-dash for a 'none' row and a dollar figure for an 'amount' row", () => {
    render(
      <TaxAdjustmentsList
        clientId="client-123"
        currentYear={2026}
        rows={[
          row({ id: "none-row", name: "No withholding", withheldMode: "none", withheldValue: 0 }),
          row({ id: "amount-row", name: "Withheld $1,200", withheldMode: "amount", withheldValue: 1_200 }),
        ]}
      />,
    );

    const noneRow = screen.getByText("No withholding").closest("li")!;
    const amountRow = screen.getByText("Withheld $1,200").closest("li")!;

    expect(noneRow).toHaveTextContent("—");
    expect(amountRow).toHaveTextContent("$1,200");
  });
});

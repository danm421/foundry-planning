// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { DebtPaydownSchedule } from "@/components/portal/debt-paydown-schedule";
import type { PaydownYearRow } from "@/lib/calculators/debt-paydown";

const ROWS: PaydownYearRow[] = [
  { year: 2026, payment: 7010, principal: 3151, interest: 3859, endingBalance: 296_849, activeDebts: 2 },
  { year: 2027, payment: 16_824, principal: 7731, interest: 9093, endingBalance: 289_118, activeDebts: 1 },
];

describe("DebtPaydownSchedule", () => {
  it("renders a row per year with the balance left", () => {
    const { container } = render(<DebtPaydownSchedule rows={ROWS} />);
    const body = container.querySelectorAll("tbody tr");
    expect(body).toHaveLength(2);
    expect(container.textContent).toContain("2026");
    expect(container.textContent).toContain("$296,849");
  });

  it("sets every numeric cell in the tabular numerals", () => {
    const { container } = render(<DebtPaydownSchedule rows={ROWS} />);
    const cells = container.querySelectorAll("tbody td");
    // Column 0 is the year label; every other cell is money or a count.
    for (const cell of Array.from(cells)) {
      expect(cell.className).toContain("tabular");
    }
  });

  it("says so rather than rendering an empty table", () => {
    const { container } = render(<DebtPaydownSchedule rows={[]} />);
    expect(container.querySelector("table")).toBeNull();
    expect(container.textContent).toContain("Nothing to schedule");
  });
});

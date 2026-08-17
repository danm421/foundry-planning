// @vitest-environment jsdom
//
// G6 / F41 + F49 — the vesting grid's "Remaining" column.
//
// Shares flow vested → exercised → sold, so sold ⊆ exercised ⊆ the row's
// shares. The old formula was `max(0, shares − exercised − sold)`, which
// subtracted the sold shares twice AND hid an impossible entry behind a zero.
// The numbers below were taken by running the REAL engine (`buildGrantTimeline`)
// and the REAL grant card (`summarizeGrant`) on the same rows, so this file
// pins the grid to what the plan actually does with the data.
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import VestingGrid, { type TrancheRow } from "../vesting-grid";
import { summarizeGrant } from "../grant-state";

function row(shares: string, sharesExercised: string, sharesSold: string): TrancheRow {
  return {
    _key: "k1", vestDate: "2024-01-01", shares, sharesExercised, sharesSold,
    acquiredOn: "", priceAtAcquisition: "",
  };
}

/** The rendered per-row "Remaining" cell and the tfoot total, as displayed. */
function renderGrid(rows: TrancheRow[], grantType: "rsu" | "nqso" | "iso") {
  const { container } = render(
    <VestingGrid
      rows={rows}
      onChange={() => {}}
      grantType={grantType}
      sharesGranted="1000"
      grantDate="2023-01-01"
    />,
  );
  const cells = Array.from(container.querySelectorAll("tbody tr")).map((tr) => {
    const tds = Array.from(tr.querySelectorAll("td"));
    return tds[tds.length - 2]; // …, Sold, Remaining, ✕
  });
  const footTds = Array.from(container.querySelectorAll("tfoot td"));
  return {
    remaining: cells.map((c) => c?.textContent ?? ""),
    remainingClass: cells.map((c) => c?.className ?? ""),
    footTotal: footTds[footTds.length - 2]?.textContent?.trim() ?? "",
  };
}

describe("VestingGrid Remaining — F49, sold shares counted once", () => {
  it("an option row that is part-exercised and part-sold agrees with the grant card", () => {
    // 1,000 granted, 400 exercised, all 400 of those sold. 600 options are
    // still live. The old formula printed 200.
    const { remaining, footTotal } = renderGrid([row("1000", "400", "400")], "nqso");

    expect(remaining).toEqual(["600"]);
    expect(footTotal).toBe("600");

    // Same rows through the grant card that renders directly below the grid.
    const summary = summarizeGrant({
      grantType: "nqso",
      currentYear: 2026,
      tranches: [{ vestYear: 2024, shares: 1000, sharesExercised: 400, sharesSold: 400 }],
    });
    expect(summary.vestedHeld + summary.exercisedHeld).toBe(600);
  });

  it("an option row exercised but not sold still shows every share", () => {
    // Exercising does not reduce the position — it changes what the shares are.
    expect(renderGrid([row("1000", "1000", "0")], "nqso").remaining).toEqual(["1,000"]);
  });

  it("an RSU row keeps subtracting only what was sold", () => {
    expect(renderGrid([row("1000", "0", "400")], "rsu").remaining).toEqual(["600"]);
  });

  it("totals several rows", () => {
    const rows = [row("1000", "400", "400"), { ...row("500", "500", "100"), _key: "k2" }];
    const { remaining, footTotal } = renderGrid(rows, "nqso");
    expect(remaining).toEqual(["600", "400"]);
    expect(footTotal).toBe("1,000");
  });
});

describe("VestingGrid Remaining — F41, an impossible entry is visible", () => {
  it("shows a negative rather than clamping it to zero", () => {
    // 1,000 shares, 1,400 sold. The old `max(0, …)` printed 0, which reads as
    // "fully disposed" instead of "this cannot be right".
    const { remaining, remainingClass } = renderGrid([row("1000", "1400", "1400")], "nqso");
    expect(remaining).toEqual(["-400"]);
    expect(remainingClass[0]).toContain("text-red-400");
  });

  it("colours a valid row normally", () => {
    const { remainingClass } = renderGrid([row("1000", "400", "400")], "nqso");
    expect(remainingClass[0]).not.toContain("text-red-400");
    expect(remainingClass[0]).toContain("text-gray-300");
  });
});

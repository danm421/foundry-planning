// @vitest-environment jsdom
//
// G8 — the "estimated" marker on the Vesting Schedule. The engine is allowed to
// fall back when a pre-plan acquisition was never entered; the screen is not
// allowed to print the result as though it were a recorded fact. Audit F1/F2.
//
// The model is built by the REAL `buildVestingSchedule`, not hand-written, so
// this covers the whole path — stored fact → engine flag → screen — rather than
// asserting that a boolean I set myself renders.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import VestingScheduleTable from "../vesting-schedule-table";
import { buildVestingSchedule } from "@/engine/equity/vesting-schedule";
import type { StockOptionPlan } from "@/engine/equity/types";

const EMPTY_STRATEGY = {
  exerciseTiming: null, exerciseYear: null, sellTiming: null,
  sellYear: null, sellPercentPerYear: null, sellStartYear: null,
};

/** Two ISO grants exercised before the plan: one with its acquisition recorded,
 *  one without. Identical in every other respect, so the marker is the only
 *  thing that can differ between the two rows. */
function twoGrants(): StockOptionPlan {
  const grant = (id: string, label: string, acquiredOn: string | null, price: number | null) => ({
    id, grantNumber: label, grantType: "iso" as const, grantDate: "2022-03-01",
    sharesGranted: 1000, has83bElection: false, fmvAtGrant: null,
    strikePrice: 12, strikeDiscountPct: null, expirationYear: 2032,
    strategy: { ...EMPTY_STRATEGY },
    tranches: [{
      id: `${id}-t1`, vestDate: "2023-03-01", shares: 1000,
      sharesExercised: 1000, sharesSold: 0,
      acquiredOn, priceAtAcquisition: price, strategy: null,
    }],
    plannedEvents: [],
  });
  return {
    accountId: "acct-1", ticker: "ACME", pricePerShare: 70, growthRate: 0,
    destinationAccountId: null, autoCreateDestination: false, sellToCover: true,
    withholdingRate: 0.22, owner: "client", strategy: { ...EMPTY_STRATEGY },
    grants: [grant("g-known", "KNOWN", "2023-04-01", 30), grant("g-guessed", "GUESSED", null, null)],
  };
}

/** The grant-label cell for a row, by its label text. */
function labelCell(text: string): HTMLElement {
  const cell = screen.getByText(text, { selector: "td" });
  return cell;
}

describe("VestingScheduleTable — the estimated-acquisition marker", () => {
  it("marks only the grant whose acquisition was never entered", () => {
    const model = buildVestingSchedule([twoGrants()], { asOfYear: 2026, planStartYear: 2026 });
    render(<VestingScheduleTable model={model} />);

    // The control: both rows rendered, so an unmarked row means "not flagged"
    // rather than "not on screen".
    expect(labelCell("GUESSED").textContent).toContain("≈");
    expect(labelCell("KNOWN").textContent).not.toContain("≈");
  });

  it("says in words what the marker means", () => {
    const model = buildVestingSchedule([twoGrants()], { asOfYear: 2026, planStartYear: 2026 });
    render(<VestingScheduleTable model={model} />);

    // A symbol with no legend is a second unlabelled guess.
    const legend = document.querySelector("p") as HTMLElement;
    expect(legend.textContent).toMatch(/acquisition date or price was never entered/i);
    expect(legend.textContent).toMatch(/estimates/i);
  });

  it("carries a hover explanation on the marker itself", () => {
    const model = buildVestingSchedule([twoGrants()], { asOfYear: 2026, planStartYear: 2026 });
    render(<VestingScheduleTable model={model} />);

    const mark = labelCell("GUESSED").querySelector("span[title]") as HTMLElement;
    expect(mark).not.toBeNull();
    expect(mark.getAttribute("title")).toMatch(/conservative estimate/i);
  });
});

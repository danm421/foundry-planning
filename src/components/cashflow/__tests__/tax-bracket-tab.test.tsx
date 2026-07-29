// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ProjectionYear } from "@/engine/types";
import { TaxBracketTab } from "../tax-bracket-tab";

// The scope group's two original members (Federal / State) are always present.
// The third — Thresholds — is a SLOT: the solver fills it with its thresholds
// panel, the cash-flow tax detail view doesn't pass one at all. These tests pin
// both halves of that contract, because a slot rendered unconditionally would
// give cash-flow an empty third button and a slot never rendered would leave
// the solver with no way to reach the report at all.
const YEARS = [] as ProjectionYear[];

describe("TaxBracketTab scope group", () => {
  it("omits the Thresholds scope button when no thresholds slot is supplied", () => {
    render(<TaxBracketTab years={YEARS} />);
    // Federal/State still there — proves the group rendered at all, so the
    // absent Thresholds button is a real omission and not a dead render.
    expect({
      federal: screen.queryByRole("button", { name: "Federal" }) !== null,
      state: screen.queryByRole("button", { name: "State" }) !== null,
      thresholds: screen.queryByRole("button", { name: "Thresholds" }) !== null,
    }).toEqual({ federal: true, state: true, thresholds: false });
  });

  it("swaps the federal bracket table for the thresholds slot when Thresholds is selected", async () => {
    render(
      <TaxBracketTab
        years={YEARS}
        thresholds={<div data-testid="thresholds-slot" />}
      />,
    );

    // Federal is the default: the bracket table's columns are on screen and the
    // slot is not.
    expect({
      bracketTable: screen.queryByText("Roth Conversion") !== null,
      slot: screen.queryByTestId("thresholds-slot") !== null,
    }).toEqual({ bracketTable: true, slot: false });

    await userEvent.click(screen.getByRole("button", { name: "Thresholds" }));

    // One `toEqual` so all three facts share a single throw point — as separate
    // `expect`s, the later two would never run once the first failed and a
    // mutation table would credit them with coverage they never executed.
    expect({
      bracketTable: screen.queryByText("Roth Conversion") !== null,
      slot: screen.queryByTestId("thresholds-slot") !== null,
      pressed: screen
        .getByRole("button", { name: "Thresholds" })
        .getAttribute("aria-pressed"),
    }).toEqual({ bracketTable: false, slot: true, pressed: "true" });
  });

  it("titles the panel for the selected scope", async () => {
    render(
      <TaxBracketTab
        years={YEARS}
        thresholds={<div data-testid="thresholds-slot" />}
      />,
    );
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("Tax Bracket");
    await userEvent.click(screen.getByRole("button", { name: "Thresholds" }));
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("Thresholds");
  });

  it("drops the All Years chip and the bracket legend in Thresholds scope", async () => {
    // The chip and legend both describe the bracket TABLE — "All Years" is a
    // lie beside a panel with its own single-year picker, and the two legend
    // glyphs mark rows that scope no longer renders.
    render(
      <TaxBracketTab
        years={YEARS}
        thresholds={<div data-testid="thresholds-slot" />}
      />,
    );
    expect({
      chip: screen.queryByText("All Years") !== null,
      legend: screen.queryByText("End Of Life") !== null,
    }).toEqual({ chip: true, legend: true });

    await userEvent.click(screen.getByRole("button", { name: "Thresholds" }));

    expect({
      chip: screen.queryByText("All Years") !== null,
      legend: screen.queryByText("End Of Life") !== null,
    }).toEqual({ chip: false, legend: false });
  });
});

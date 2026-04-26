// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  ScenarioInputStyling,
  useScenarioInputClass,
} from "../scenario-input-styling";

function Probe() {
  const cls = useScenarioInputClass();
  return <span data-testid="probe">{cls === "" ? "<empty>" : cls}</span>;
}

describe("useScenarioInputClass", () => {
  it("returns empty string outside any provider (base mode default)", () => {
    render(<Probe />);
    expect(screen.getByTestId("probe").textContent).toBe("<empty>");
  });

  it("returns 'scenario-editable' when active=true", () => {
    render(
      <ScenarioInputStyling active={true}>
        <Probe />
      </ScenarioInputStyling>,
    );
    expect(screen.getByTestId("probe").textContent).toBe("scenario-editable");
  });

  it("returns empty string when active=false", () => {
    render(
      <ScenarioInputStyling active={false}>
        <Probe />
      </ScenarioInputStyling>,
    );
    expect(screen.getByTestId("probe").textContent).toBe("<empty>");
  });
});

// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AssumptionsStep } from "../assumptions-step";
import { buildQsContext } from "@/lib/quick-start/derive";
import type { QsBootstrap } from "@/lib/quick-start/bootstrap";
import { mockFetch, findCall } from "./fetch-mock";

const bootstrap = {
  clientId: "c1",
  residenceState: "CA",
  defaultGrowth: {
    taxable: 0.07,
    cash: 0.02,
    retirement: 0.07,
    realEstate: 0.04,
    lifeInsurance: 0.03,
    inflation: 0.03,
  },
} as unknown as QsBootstrap;

const ctx = buildQsContext({
  client: {
    dateOfBirth: "1965-04-15",
    retirementAge: 65,
    planEndAge: 95,
    spouseDob: null,
    spouseRetirementAge: null,
  },
  planStartYear: 2026,
  planEndYear: 2060,
  clientFirstName: "Alice",
  spouseFirstName: null,
  hasSpouse: false,
});

describe("AssumptionsStep", () => {
  let saveFn: () => Promise<void>;
  beforeEach(() => {
    mockFetch();
    saveFn = async () => {};
  });

  function renderStep() {
    render(
      <AssumptionsStep
        ctx={ctx}
        bootstrap={bootstrap}
        busy={false}
        registerSave={(fn) => {
          saveFn = fn;
        }}
      />,
    );
  }

  it("brackets mode PUTs plan settings with converted growth", async () => {
    renderStep();
    // Taxable growth input should display "7" (0.07 * 100)
    fireEvent.change(screen.getByLabelText("Taxable growth"), { target: { value: "8" } });
    await saveFn();
    const body = JSON.parse(findCall((u) => u.endsWith("/plan-settings"))[1].body);
    expect(body).toMatchObject({
      taxEngineMode: "bracket",
      residenceState: "CA",
      defaultGrowthTaxable: 0.08,
    });
    // Other growth values round-trip from defaults
    expect(body.defaultGrowthCash).toBe(0.02);
    expect(body.defaultGrowthRetirement).toBe(0.07);
    expect(body.defaultGrowthRealEstate).toBe(0.04);
    expect(body.defaultGrowthLifeInsurance).toBe(0.03);
    expect(body.inflationRate).toBe(0.03);
  });

  it("flat mode reveals federal and state rate inputs and sends flat payload", async () => {
    renderStep();
    fireEvent.click(screen.getByLabelText("Use flat rates"));
    expect(screen.getByLabelText("Federal rate")).toBeTruthy();
    expect(screen.getByLabelText("State rate")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Federal rate"), { target: { value: "25" } });
    fireEvent.change(screen.getByLabelText("State rate"), { target: { value: "8" } });
    await saveFn();
    const body = JSON.parse(findCall((u) => u.endsWith("/plan-settings"))[1].body);
    expect(body).toMatchObject({
      taxEngineMode: "flat",
      flatFederalRate: 0.25,
      flatStateRate: 0.08,
    });
  });

  it("flat-rate inputs are hidden in brackets mode", () => {
    renderStep();
    // Default is brackets — flat inputs should not be present
    expect(screen.queryByLabelText("Federal rate")).toBeNull();
    expect(screen.queryByLabelText("State rate")).toBeNull();
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { SolverSummaryPanel } from "../solver-summary-panel";
import type { ProjectionYear } from "@/engine";

vi.mock("@/components/solver/summaries/registry", () => {
  const def = { label: "", build: () => ({}), Component: () => null };
  return {
    SUMMARY_TABS: [
      { key: "retirement", label: "Retirement" },
      { key: "tax", label: "Tax" },
      { key: "medicare", label: "Medicare" },
      { key: "estate", label: "Estate" },
      { key: "lifeInsurance", label: "Life Insurance" },
    ],
    SUMMARY_REGISTRY: { retirement: def, tax: def, medicare: def, estate: def, lifeInsurance: def },
  };
});

const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());

const base = {
  clientId: "c1", source: "base" as const, mutations: [],
  years: [{ year: 2025 }] as unknown as ProjectionYear[],
  workingTree: { client: {} } as never,
  clientName: "Ada", spouseName: null, mcSuccessRate: 0.9,
};

describe("SolverSummaryPanel", () => {
  it("renders the sub-tab row and switches summaries", () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <SolverSummaryPanel {...base} activeSummary="tax" onSummaryChange={onChange} />,
    );
    fireEvent.click(getByRole("tab", { name: "Medicare" }));
    expect(onChange).toHaveBeenCalledWith("medicare");
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PlanSettings } from "@/engine/types";
import { ChipBar } from "../chip-bar";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const settings: Partial<PlanSettings> = {
  flatFederalRate: 0.22,
  inflationRate: 0.03,
  flatStateEstateRate: 0.1,
  planEndYear: 2070,
};

describe("ChipBar — trimmed chip set", () => {
  it("renders only state-estate and plan-end-year chips", () => {
    render(
      <ChipBar
        clientId="c1"
        planSettings={settings as PlanSettings}
        onOpenAssumptions={() => {}}
      />,
    );
    expect(screen.getByText(/State estate %/)).toBeInTheDocument();
    expect(screen.getByText(/Plan end year/)).toBeInTheDocument();
    expect(screen.queryByText(/Federal tax %/)).toBeNull();
    expect(screen.queryByText(/Inflation %/)).toBeNull();
  });
});

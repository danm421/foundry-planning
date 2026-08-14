// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InvestmentProposalOptionsControl } from "./options-control";
import { PresentationOptionsProvider } from "@/components/presentations/options-context";
import { EMPTY_INVESTMENT_OPTION_CATALOG } from "@/lib/presentations/investment-option-catalog";
import {
  INVESTMENT_PROPOSAL_OPTIONS_DEFAULT,
  SECTION_IDS,
  type InvestmentProposalOptions,
} from "@/lib/presentations/pages/investment-proposal/options-schema";
import type { ProposalOption } from "@/lib/presentations/investment-proposal-bundle";

const PROPOSALS: ProposalOption[] = [
  { id: "p1", name: "Move to the core model", targetLabel: "60/40 Core", computedAt: "2026-08-12T00:00:00.000Z" },
  { id: "p2", name: "All-weather", targetLabel: "Risk Parity", computedAt: "2026-08-11T00:00:00.000Z" },
];

function renderControl(
  overrides: Partial<InvestmentProposalOptions> = {},
  proposals: ProposalOption[] = PROPOSALS,
) {
  const onChange = vi.fn();
  const value = { ...INVESTMENT_PROPOSAL_OPTIONS_DEFAULT, ...overrides };
  render(
    <PresentationOptionsProvider
      value={{
        investmentCatalog: EMPTY_INVESTMENT_OPTION_CATALOG,
        scenarios: [],
        clientId: "c1",
        proposals,
      }}
    >
      <InvestmentProposalOptionsControl value={value} onChange={onChange} />
    </PresentationOptionsProvider>,
  );
  return { onChange };
}

describe("InvestmentProposalOptionsControl", () => {
  it("lists every saved proposal behind an explicit unpicked choice", () => {
    renderControl();
    const picker = screen.getByLabelText("Proposal") as HTMLSelectElement;
    expect([...picker.options].map((o) => o.value)).toEqual(["", "p1", "p2"]);
    expect(picker.value).toBe("");
    expect(screen.getByText("— No proposal picked —")).toBeInTheDocument();
  });

  it("still renders with no saved proposals, rather than an empty picker", () => {
    renderControl({}, []);
    const picker = screen.getByLabelText("Proposal") as HTMLSelectElement;
    expect([...picker.options].map((o) => o.value)).toEqual([""]);
  });

  it("reports the picked proposal id", () => {
    const { onChange } = renderControl();
    fireEvent.change(screen.getByLabelText("Proposal"), { target: { value: "p2" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ proposalId: "p2" }),
    );
  });

  it("offers one checkbox per printable section, all on by default", () => {
    renderControl();
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes).toHaveLength(SECTION_IDS.length);
    expect(boxes.every((b) => b.checked)).toBe(true);
  });

  it("turns a single section off without disturbing the others", () => {
    const { onChange } = renderControl();
    fireEvent.click(screen.getByLabelText("Commentary"));
    const next = onChange.mock.calls[0][0] as InvestmentProposalOptions;
    expect(next.sections.commentary).toBe(false);
    expect(next.sections.verdict).toBe(true);
  });

  it("reports tone and length changes", () => {
    const { onChange } = renderControl();
    fireEvent.change(screen.getByLabelText("Commentary tone"), { target: { value: "concise" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ tone: "concise" }));

    fireEvent.change(screen.getByLabelText("Commentary length"), { target: { value: "long" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ length: "long" }));
  });
});

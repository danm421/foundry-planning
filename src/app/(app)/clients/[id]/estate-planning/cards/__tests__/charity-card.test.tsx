// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { CharityCard } from "../charity-card";
import type { CharityCardData } from "../../lib/derive-card-data";

vi.mock("@dnd-kit/core", () => ({
  useDroppable: () => ({
    isOver: false,
    setNodeRef: () => undefined,
  }),
}));

vi.mock("../../dnd-context-provider", () => ({
  useBequestEdit: () => ({ onEditBequest: vi.fn() }),
}));

const withBequest: CharityCardData = {
  externalBeneficiaryId: "ex1",
  name: "Stanford University",
  bequestsReceived: [
    { bequestId: "b2", willId: "w1", willGrantor: "client", assetName: "Donor-Advised Fund", condition: "always", percentage: 100 },
  ],
  lifetimeGifts: [],
  breach: false,
};

const withGifts: CharityCardData = {
  externalBeneficiaryId: "ex2",
  name: "Red Cross",
  bequestsReceived: [],
  lifetimeGifts: [
    { year: 2023, amount: 5_000, assetClass: "cash", sourceLabel: "Cash gift" },
    { year: 2025, amount: 10_000, assetClass: "cash", sourceLabel: "Cash gift" },
  ],
  breach: false,
};

const emptyCharity: CharityCardData = {
  externalBeneficiaryId: "ex3",
  name: "Empty Charity",
  bequestsReceived: [],
  lifetimeGifts: [],
  breach: false,
};

describe("CharityCard", () => {
  it("renders collapsed with name and bequest count", () => {
    render(<CharityCard data={withBequest} />);
    expect(screen.getByText("Stanford University")).toBeInTheDocument();
    expect(screen.getByText(/1 bequest/i)).toBeInTheDocument();
  });

  it("expands and shows bequest rows", () => {
    render(<CharityCard data={withBequest} defaultExpanded />);
    expect(screen.getByText("Donor-Advised Fund")).toBeInTheDocument();
    expect(screen.getByText(/100%/)).toBeInTheDocument();
  });

  it("toggles on click", () => {
    render(<CharityCard data={withBequest} />);
    fireEvent.click(screen.getByRole("button", { name: /Stanford University/i }));
    expect(screen.getByText("Donor-Advised Fund")).toBeInTheDocument();
  });

  it("renders lifetime cash gifts under bequests", () => {
    render(<CharityCard data={withGifts} defaultExpanded />);
    // Both gift source labels are visible (may appear multiple times since there are two rows)
    expect(screen.getAllByText(/Cash gift/).length).toBeGreaterThan(0);
    // Both gift years visible
    expect(screen.getByText("2023")).toBeInTheDocument();
    expect(screen.getByText("2025")).toBeInTheDocument();
  });

  it("renders empty-state when no gifts and no bequests", () => {
    render(<CharityCard data={emptyCharity} defaultExpanded />);
    expect(screen.getByText(/No bequests or lifetime gifts yet/i)).toBeInTheDocument();
  });

  it("renders breach glyph when data.breach is true", () => {
    render(<CharityCard data={{ ...withBequest, breach: true }} />);
    expect(screen.getByLabelText(/exceeds lifetime exemption/i)).toBeInTheDocument();
  });

  it("does not render breach glyph when data.breach is false", () => {
    render(<CharityCard data={{ ...withBequest, breach: false }} />);
    expect(screen.queryByLabelText(/exceeds lifetime exemption/i)).not.toBeInTheDocument();
  });
});

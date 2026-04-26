// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { CharityCard } from "../charity-card";
import type { CharityCardData } from "../../lib/derive-card-data";

const data: CharityCardData = {
  externalBeneficiaryId: "ex1",
  name: "Stanford University",
  bequestsReceived: [
    { bequestId: "b2", willId: "w1", willGrantor: "client", assetName: "Donor-Advised Fund", condition: "always", percentage: 100 },
  ],
};

describe("CharityCard", () => {
  it("renders collapsed with name and bequest count", () => {
    render(<CharityCard data={data} />);
    expect(screen.getByText("Stanford University")).toBeInTheDocument();
    expect(screen.getByText(/1 bequest/i)).toBeInTheDocument();
  });

  it("expands and shows bequest rows", () => {
    render(<CharityCard data={data} defaultExpanded />);
    expect(screen.getByText("Donor-Advised Fund")).toBeInTheDocument();
    expect(screen.getByText(/100%/)).toBeInTheDocument();
  });

  it("toggles on click", () => {
    render(<CharityCard data={data} />);
    fireEvent.click(screen.getByRole("button", { name: /Stanford University/i }));
    expect(screen.getByText("Donor-Advised Fund")).toBeInTheDocument();
  });
});

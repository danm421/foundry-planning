// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ClientCard } from "../client-card";
import type { ClientCardData } from "../../lib/derive-card-data";

const data: ClientCardData = {
  ownerKey: "client",
  name: "Tom Smith",
  ageDescriptor: "Age 58 · Grantor of 2 trusts",
  outrightAssets: [
    { id: "a1", name: "401k", category: "retirement", tag: "DEF", value: 500_000 },
  ],
  jointAssets: [
    { id: "a2", name: "Joint Brokerage", category: "taxable", tag: "TAX", value: 1_000_000 },
  ],
  outrightTotal: 500_000,
  jointHalfTotal: 500_000,
};

describe("ClientCard", () => {
  it("renders collapsed by default with name and total", () => {
    render(<ClientCard data={data} />);
    expect(screen.getByText("Tom Smith")).toBeInTheDocument();
    expect(screen.getByText("Age 58 · Grantor of 2 trusts")).toBeInTheDocument();
    expect(screen.queryByText("401k")).not.toBeInTheDocument();
  });

  it("expands when the card row is clicked", () => {
    render(<ClientCard data={data} />);
    fireEvent.click(screen.getByRole("button", { name: /Tom Smith/i }));
    expect(screen.getByText("401k")).toBeInTheDocument();
    expect(screen.getByText("Joint Brokerage")).toBeInTheDocument();
  });

  it("marks joint assets with the locked affordance", () => {
    render(<ClientCard data={data} defaultExpanded />);
    const jointRow = screen.getByText("Joint Brokerage").closest("[data-row-kind]");
    expect(jointRow).toHaveAttribute("data-row-kind", "joint-locked");
  });

  it("renders the tax-treatment tag for outright assets", () => {
    render(<ClientCard data={data} defaultExpanded />);
    expect(screen.getByText("DEF")).toBeInTheDocument();
  });

  it("hides the Jointly Held section header when there are no joint assets", () => {
    const widowed: ClientCardData = { ...data, jointAssets: [], jointHalfTotal: 0 };
    render(<ClientCard data={widowed} defaultExpanded />);
    expect(screen.queryByText(/Jointly held/i)).not.toBeInTheDocument();
  });
});

// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import OutOfEstateTable from "../out-of-estate-table";

describe("OutOfEstateTable", () => {
  const vm = {
    selectedYear: 2026,
    outOfEstateNetWorth: 360_000,
    outOfEstateOwnerRows: [
      { ownerKey: "en:trust-1", ownerName: "Smith Family IDGT", ownerType: "trust" as const, assetTotal: 300_000, liabilityTotal: 0, net: 300_000 },
      { ownerKey: "fm:fm-child", ownerName: "Emma", ownerType: "person" as const, assetTotal: 60_000, liabilityTotal: 0, net: 60_000 },
    ],
  };

  it("renders one net row per owner plus the grand total", () => {
    render(<OutOfEstateTable vm={vm} />);
    expect(screen.getByText("Smith Family IDGT")).toBeInTheDocument();
    expect(screen.getByText("Emma")).toBeInTheDocument();
    expect(screen.getByText("$300,000")).toBeInTheDocument();
    expect(screen.getByText("$60,000")).toBeInTheDocument();
    expect(screen.getByText("Net Out of Estate")).toBeInTheDocument();
    expect(screen.getByText("$360,000")).toBeInTheDocument();
  });

  it("renders nothing when there are no out-of-estate owners", () => {
    const { container } = render(<OutOfEstateTable vm={{ selectedYear: 2026, outOfEstateNetWorth: 0, outOfEstateOwnerRows: [] }} />);
    expect(container.firstChild).toBeNull();
  });
});

// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PortalNetWorthHeader } from "../portal-networth-header";

describe("PortalNetWorthHeader", () => {
  it("shows assets, debt, and net worth", () => {
    render(<PortalNetWorthHeader assets={1000000} debt={250000} netWorth={750000} />);
    expect(screen.getByText("$1,000,000")).toBeInTheDocument();
    expect(screen.getByText("$250,000")).toBeInTheDocument();
    expect(screen.getByText("$750,000")).toBeInTheDocument();
    expect(screen.getByText(/net worth/i)).toBeInTheDocument();
  });
});

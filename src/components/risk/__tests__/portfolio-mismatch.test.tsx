// src/components/risk/__tests__/portfolio-mismatch.test.tsx
// @vitest-environment jsdom
import { it, expect, describe, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { PortfolioMismatch } from "@/components/risk/portfolio-mismatch";
import type { BucketReadout } from "@/lib/risk/portfolio-mismatch";

const BUCKETS: BucketReadout[] = [
  { label: "Taxable", value: "Balanced Growth" },
  { label: "Retirement", value: "Custom 6.00%" },
];

const EDIT_HREF = "/clients/c1/details/assumptions?tab=growth-inflation";

describe("PortfolioMismatch", () => {
  it("names the target portfolio and lists every bucket on a mismatch", () => {
    render(
      <PortfolioMismatch
        clientId="c1"
        state={{
          kind: "mismatch",
          level: "moderate",
          targetName: "Aggressive Growth",
          applyToPortfolioId: "pf-aggr",
          buckets: BUCKETS,
        }}
      />,
    );
    expect(screen.getByText(/Profile calls for Aggressive Growth/)).toBeTruthy();
    expect(screen.getByText("Taxable")).toBeTruthy();
    expect(screen.getByText("Balanced Growth")).toBeTruthy();
    expect(screen.getByText("Retirement")).toBeTruthy();
    expect(screen.getByText("Custom 6.00%")).toBeTruthy();
  });

  it("offers Apply only on a mismatch, and links to the editor in both states", () => {
    const { unmount } = render(
      <PortfolioMismatch
        clientId="c1"
        state={{
          kind: "mismatch",
          level: "moderate",
          targetName: "Aggressive Growth",
          applyToPortfolioId: "pf-aggr",
          buckets: BUCKETS,
        }}
      />,
    );
    expect(screen.getByRole("button", { name: "Apply Aggressive Growth portfolio" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Edit in Assumptions" }).getAttribute("href")).toBe(
      EDIT_HREF,
    );
    unmount();

    render(
      <PortfolioMismatch
        clientId="c1"
        state={{
          kind: "aligned",
          level: "moderate",
          targetName: "Balanced Growth",
          buckets: BUCKETS,
        }}
      />,
    );
    expect(screen.getByText("Portfolio matches this profile.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Apply/ })).toBeNull();
    expect(screen.getByText("Taxable")).toBeTruthy();
    expect(screen.getByText("Balanced Growth")).toBeTruthy();
    expect(screen.getByText("Retirement")).toBeTruthy();
    expect(screen.getByText("Custom 6.00%")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Edit in Assumptions" }).getAttribute("href")).toBe(
      EDIT_HREF,
    );
  });

  it("still shows the readout and the editor link when the rung is untagged", () => {
    render(
      <PortfolioMismatch
        clientId="c1"
        state={{ kind: "untagged", level: "moderate", buckets: BUCKETS }}
      />,
    );
    expect(screen.getByText(/No model portfolio is tagged Moderate/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Tag one in CMA" })).toBeTruthy();
    expect(screen.getByText("Balanced Growth")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Apply/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Edit in Assumptions" }).getAttribute("href")).toBe(
      EDIT_HREF,
    );
  });

  it("renders nothing when the household has no profile", () => {
    const { container } = render(
      <PortfolioMismatch clientId="c1" state={{ kind: "no_profile" }} />,
    );
    expect(container.firstChild).toBeNull();
  });
});

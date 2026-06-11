// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

import { usePathname, useSearchParams } from "next/navigation";
import HeaderSubtabs from "../header-subtabs";

const mockSearchParams = (init?: string) =>
  new URLSearchParams(init) as unknown as ReturnType<typeof useSearchParams>;

beforeEach(() => {
  vi.mocked(useSearchParams).mockReturnValue(mockSearchParams());
});

describe("HeaderSubtabs", () => {
  it("renders nothing on a section without sub-reports (details)", () => {
    vi.mocked(usePathname).mockReturnValue("/clients/c1/details");
    const { container } = render(<HeaderSubtabs clientId="c1" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing on the analysis section (no strip historically)", () => {
    vi.mocked(usePathname).mockReturnValue("/clients/c1/analysis/retirement");
    const { container } = render(<HeaderSubtabs clientId="c1" />);
    expect(container.firstChild).toBeNull();
  });

  describe("cash flow section", () => {
    it("renders sub-tabs in order with expected hrefs", () => {
      vi.mocked(usePathname).mockReturnValue("/clients/c1/cashflow");
      const { container } = render(<HeaderSubtabs clientId="c1" />);
      const links = Array.from(container.querySelectorAll("a"));
      expect(links.map((a) => a.textContent?.trim())).toEqual([
        "Cash Flow",
        "Income Tax",
        "Ledgers",
        "Monte Carlo",
        "Timeline",
        "Entities",
        "Stock Options",
      ]);
      expect(links.map((a) => a.getAttribute("href"))).toEqual([
        "/clients/c1/cashflow",
        "/clients/c1/cashflow/income-tax",
        "/clients/c1/cashflow/ledgers",
        "/clients/c1/cashflow/monte-carlo",
        "/clients/c1/cashflow/timeline",
        "/clients/c1/cashflow/entities",
        "/clients/c1/cashflow/stock-options",
      ]);
    });

    it("marks the Cash Flow root active only on the exact root path", () => {
      vi.mocked(usePathname).mockReturnValue("/clients/c1/cashflow");
      const { container } = render(<HeaderSubtabs clientId="c1" />);
      const root = Array.from(container.querySelectorAll("a")).find(
        (a) => a.textContent?.trim() === "Cash Flow",
      );
      expect(root?.getAttribute("aria-selected")).toBe("true");
      expect(root?.className).toContain("border-accent");
    });

    it("does NOT mark the Cash Flow root active on a sub-route", () => {
      vi.mocked(usePathname).mockReturnValue("/clients/c1/cashflow/income-tax");
      const { container } = render(<HeaderSubtabs clientId="c1" />);
      const root = Array.from(container.querySelectorAll("a")).find(
        (a) => a.textContent?.trim() === "Cash Flow",
      );
      expect(root?.getAttribute("aria-selected")).not.toBe("true");
      const incomeTax = Array.from(container.querySelectorAll("a")).find(
        (a) => a.textContent?.trim() === "Income Tax",
      );
      expect(incomeTax?.getAttribute("aria-selected")).toBe("true");
    });

    it("marks the Ledgers tab active on a nested ledger sub-report route", () => {
      vi.mocked(usePathname).mockReturnValue("/clients/c1/cashflow/ledgers/asset-ledger");
      const { container } = render(<HeaderSubtabs clientId="c1" />);
      const ledgers = Array.from(container.querySelectorAll("a")).find(
        (a) => a.textContent?.trim() === "Ledgers",
      );
      expect(ledgers?.getAttribute("aria-selected")).toBe("true");
      expect(ledgers?.className).toContain("border-accent");
    });
  });

  describe("assets section", () => {
    it("renders Balance Sheet and Investments with expected hrefs", () => {
      vi.mocked(usePathname).mockReturnValue("/clients/c1/assets/investments");
      const { container } = render(<HeaderSubtabs clientId="c1" />);
      const links = Array.from(container.querySelectorAll("a"));
      expect(links.map((a) => a.textContent?.trim())).toEqual([
        "Balance Sheet",
        "Investments",
      ]);
      expect(links.map((a) => a.getAttribute("href"))).toEqual([
        "/clients/c1/assets/balance-sheet-report",
        "/clients/c1/assets/investments",
      ]);
    });
  });

  describe("estate planning section", () => {
    it("renders sub-tabs in order with expected hrefs", () => {
      vi.mocked(usePathname).mockReturnValue("/clients/c1/estate-planning/estate-flow");
      const { container } = render(<HeaderSubtabs clientId="c1" />);
      const links = Array.from(container.querySelectorAll("a"));
      expect(links.map((a) => a.textContent?.trim())).toEqual([
        "Estate Flow",
        "Estate Tax",
        "Estate Transfer",
        "Liquidity",
        "Gift Tax",
      ]);
      expect(links.map((a) => a.getAttribute("href"))).toEqual([
        "/clients/c1/estate-planning/estate-flow",
        "/clients/c1/estate-planning/estate-tax",
        "/clients/c1/estate-planning/estate-transfer",
        "/clients/c1/estate-planning/liquidity",
        "/clients/c1/estate-planning/gift-tax",
      ]);
    });

    it.each([
      ["Estate Flow", "/clients/c1/estate-planning/estate-flow"],
      ["Estate Tax", "/clients/c1/estate-planning/estate-tax"],
      ["Estate Transfer", "/clients/c1/estate-planning/estate-transfer"],
      ["Liquidity", "/clients/c1/estate-planning/liquidity"],
      ["Gift Tax", "/clients/c1/estate-planning/gift-tax"],
    ])("marks %s active when on its route", (label, path) => {
      vi.mocked(usePathname).mockReturnValue(path);
      const { container } = render(<HeaderSubtabs clientId="c1" />);
      const tab = Array.from(container.querySelectorAll("a")).find(
        (a) => a.textContent?.trim() === label,
      );
      expect(tab?.getAttribute("aria-selected")).toBe("true");
      expect(tab?.className).toContain("border-accent");
    });

    it("does NOT mark Estate Tax active on a sibling route that shares its prefix", () => {
      vi.mocked(usePathname).mockReturnValue(
        "/clients/c1/estate-planning/estate-tax-summary",
      );
      const { container } = render(<HeaderSubtabs clientId="c1" />);
      const estateTax = Array.from(container.querySelectorAll("a")).find(
        (a) => a.textContent?.trim() === "Estate Tax",
      );
      expect(estateTax?.getAttribute("aria-selected")).not.toBe("true");
      expect(estateTax?.className).not.toContain("border-accent");
    });
  });

  it("preserves ?scenario= on every sub-tab href when set", () => {
    vi.mocked(usePathname).mockReturnValue("/clients/c1/cashflow");
    vi.mocked(useSearchParams).mockReturnValue(mockSearchParams("scenario=sc-1"));
    const { container } = render(<HeaderSubtabs clientId="c1" />);
    const links = Array.from(container.querySelectorAll("a"));
    for (const a of links) {
      expect(a.getAttribute("href")).toContain("?scenario=sc-1");
    }
  });
});

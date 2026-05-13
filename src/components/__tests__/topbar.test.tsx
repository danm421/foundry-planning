// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

import { usePathname, useSearchParams } from "next/navigation";
import Topbar from "../topbar";

beforeEach(() => {
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams() as unknown as ReturnType<typeof useSearchParams>,
  );
});

describe("Topbar", () => {
  it("renders a sticky header", () => {
    vi.mocked(usePathname).mockReturnValue("/clients");
    const { container } = render(<Topbar />);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain("sticky");
    expect(el.className).toContain("top-0");
  });

  it("renders the breadcrumb in the left slot", () => {
    vi.mocked(usePathname).mockReturnValue("/clients");
    const { container } = render(<Topbar />);
    expect(container.textContent).toContain("Clients");
  });

  it("does not render report tabs outside a client route", () => {
    vi.mocked(usePathname).mockReturnValue("/cma");
    const { container } = render(<Topbar />);
    expect(container.querySelector("nav[role='tablist']")).toBeNull();
  });

  it("renders all 6 tabs in order on a client route", () => {
    vi.mocked(usePathname).mockReturnValue("/clients/c1/overview");
    const { container } = render(<Topbar />);
    const text = container.textContent ?? "";
    const expected = [
      "Overview",
      "Details",
      "Assets",
      "Cash Flow",
      "Estate Planning",
      "Comparison",
    ];
    let last = -1;
    for (const label of expected) {
      const idx = text.indexOf(label);
      expect(idx).toBeGreaterThan(last);
      last = idx;
    }
  });

  it("marks the active tab based on pathname", () => {
    vi.mocked(usePathname).mockReturnValue("/clients/c1/cashflow");
    const { container } = render(<Topbar />);
    const cashflow = Array.from(container.querySelectorAll("a")).find(
      (a) => a.textContent?.trim() === "Cash Flow",
    );
    expect(cashflow?.getAttribute("aria-selected")).toBe("true");
    expect(cashflow?.className).toContain("border-accent");
  });

  it("preserves ?scenario= on every tab href when active", () => {
    vi.mocked(usePathname).mockReturnValue("/clients/c1/overview");
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams("scenario=sc-1") as unknown as ReturnType<typeof useSearchParams>,
    );
    const { container } = render(<Topbar />);
    const links = Array.from(container.querySelectorAll("a"));
    expect(links.length).toBeGreaterThanOrEqual(6);
    for (const a of links) {
      expect(a.getAttribute("href")).toContain("?scenario=sc-1");
    }
  });

  it("renders sub-tab links in a hover menu for tabs that have sub-reports", () => {
    vi.mocked(usePathname).mockReturnValue("/clients/c1/overview");
    const { container } = render(<Topbar />);
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) =>
      a.getAttribute("href") ?? "",
    );
    expect(hrefs).toEqual(
      expect.arrayContaining([
        expect.stringContaining("/clients/c1/cashflow/income-tax"),
        expect.stringContaining("/clients/c1/cashflow/monte-carlo"),
        expect.stringContaining("/clients/c1/cashflow/timeline"),
        expect.stringContaining("/clients/c1/assets/balance-sheet-report"),
        expect.stringContaining("/clients/c1/assets/investments"),
        expect.stringContaining("/clients/c1/estate-planning/estate-tax"),
      ]),
    );
    const menus = container.querySelectorAll("[role='menu']");
    expect(menus.length).toBe(3);
  });
});

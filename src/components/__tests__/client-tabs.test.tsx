// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(),
}));

import { usePathname } from "next/navigation";
import ClientTabs from "../client-tabs";

describe("ClientTabs", () => {
  it("renders all 8 tabs in order", () => {
    (usePathname as ReturnType<typeof vi.fn>).mockReturnValue("/clients/c1/overview");
    const { container } = render(<ClientTabs clientId="c1" />);
    const text = container.textContent ?? "";
    const expected = [
      "Overview",
      "Details",
      "Balance Sheet",
      "Cash Flow",
      "Investments",
      "Timeline",
      "Estate Tax",
      "Monte Carlo",
    ];
    let last = -1;
    for (const label of expected) {
      const idx = text.indexOf(label);
      expect(idx).toBeGreaterThan(last);
      last = idx;
    }
  });

  it("marks Overview active when on overview route", () => {
    (usePathname as ReturnType<typeof vi.fn>).mockReturnValue("/clients/c1/overview");
    const { container } = render(<ClientTabs clientId="c1" />);
    const overview = Array.from(container.querySelectorAll("a")).find(
      (a) => a.textContent?.trim() === "Overview",
    );
    expect(overview?.className).toContain("border-accent");
    expect(overview?.getAttribute("aria-selected")).toBe("true");
  });

  it("marks Cash Flow active when on cashflow route", () => {
    (usePathname as ReturnType<typeof vi.fn>).mockReturnValue("/clients/c1/cashflow");
    const { container } = render(<ClientTabs clientId="c1" />);
    const cashflow = Array.from(container.querySelectorAll("a")).find(
      (a) => a.textContent?.trim() === "Cash Flow",
    );
    expect(cashflow?.getAttribute("aria-selected")).toBe("true");
  });

  it("does not mark any tab active on an unrelated path", () => {
    (usePathname as ReturnType<typeof vi.fn>).mockReturnValue("/other");
    const { container } = render(<ClientTabs clientId="c1" />);
    const anyActive = Array.from(container.querySelectorAll("a")).some(
      (a) => a.getAttribute("aria-selected") === "true",
    );
    expect(anyActive).toBe(false);
  });

  it("applies sticky top-14 so tabs pin below topbar", () => {
    (usePathname as ReturnType<typeof vi.fn>).mockReturnValue("/clients/c1/overview");
    const { container } = render(<ClientTabs clientId="c1" />);
    const nav = container.querySelector("nav");
    expect(nav?.className).toContain("sticky");
    expect(nav?.className).toContain("top-14");
  });
});

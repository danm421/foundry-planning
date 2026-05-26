// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

import { usePathname, useSearchParams } from "next/navigation";
import EstatePlanningSubtabs from "../subtabs";

const mockSearchParams = (init?: string) =>
  new URLSearchParams(init) as unknown as ReturnType<typeof useSearchParams>;

beforeEach(() => {
  vi.mocked(useSearchParams).mockReturnValue(mockSearchParams());
});

describe("EstatePlanningSubtabs", () => {
  it("renders sub-tabs in order: Estate Flow, Estate Tax, Estate Transfer, Liquidity, Gift Tax", () => {
    vi.mocked(usePathname).mockReturnValue("/clients/c1/estate-planning/estate-flow");
    const { container } = render(<EstatePlanningSubtabs clientId="c1" />);
    const text = container.textContent ?? "";
    const expected = [
      "Estate Flow",
      "Estate Tax",
      "Estate Transfer",
      "Liquidity",
      "Gift Tax",
    ];
    let last = -1;
    for (const label of expected) {
      const idx = text.indexOf(label);
      expect(idx).toBeGreaterThan(last);
      last = idx;
    }
  });

  it("renders anchor tags with the expected hrefs", () => {
    vi.mocked(usePathname).mockReturnValue("/clients/c1/estate-planning/estate-flow");
    const { container } = render(<EstatePlanningSubtabs clientId="c1" />);
    const links = Array.from(container.querySelectorAll("a"));
    expect(links).toHaveLength(5);
    expect(links[0].getAttribute("href")).toBe("/clients/c1/estate-planning/estate-flow");
    expect(links[1].getAttribute("href")).toBe("/clients/c1/estate-planning/estate-tax");
    expect(links[2].getAttribute("href")).toBe("/clients/c1/estate-planning/estate-transfer");
    expect(links[3].getAttribute("href")).toBe("/clients/c1/estate-planning/liquidity");
    expect(links[4].getAttribute("href")).toBe("/clients/c1/estate-planning/gift-tax");
  });

  it.each([
    ["Estate Flow", "/clients/c1/estate-planning/estate-flow"],
    ["Estate Tax", "/clients/c1/estate-planning/estate-tax"],
    ["Estate Transfer", "/clients/c1/estate-planning/estate-transfer"],
    ["Liquidity", "/clients/c1/estate-planning/liquidity"],
    ["Gift Tax", "/clients/c1/estate-planning/gift-tax"],
  ])("marks %s active when on its route", (label, path) => {
    vi.mocked(usePathname).mockReturnValue(path);
    const { container } = render(<EstatePlanningSubtabs clientId="c1" />);
    const tab = Array.from(container.querySelectorAll("a")).find(
      (a) => a.textContent?.trim() === label,
    );
    expect(tab?.getAttribute("aria-selected")).toBe("true");
    expect(tab?.className).toContain("border-accent");
  });

  it("preserves ?scenario= on every sub-tab href when set", () => {
    vi.mocked(usePathname).mockReturnValue("/clients/c1/estate-planning/estate-flow");
    vi.mocked(useSearchParams).mockReturnValue(mockSearchParams("scenario=sc-1"));
    const { container } = render(<EstatePlanningSubtabs clientId="c1" />);
    const links = Array.from(container.querySelectorAll("a"));
    for (const a of links) {
      expect(a.getAttribute("href")).toContain("?scenario=sc-1");
    }
  });

  it("renders a sticky nav so it pins below the top-level tab strip", () => {
    vi.mocked(usePathname).mockReturnValue("/clients/c1/estate-planning/estate-flow");
    const { container } = render(<EstatePlanningSubtabs clientId="c1" />);
    const nav = container.querySelector("nav");
    expect(nav?.className).toContain("sticky");
  });

  it("does NOT mark Estate Tax active on a sibling route that shares its prefix", () => {
    vi.mocked(usePathname).mockReturnValue("/clients/c1/estate-planning/estate-tax-summary");
    const { container } = render(<EstatePlanningSubtabs clientId="c1" />);
    const estateTax = Array.from(container.querySelectorAll("a")).find(
      (a) => a.textContent?.trim() === "Estate Tax",
    );
    expect(estateTax?.getAttribute("aria-selected")).not.toBe("true");
    expect(estateTax?.className).not.toContain("border-accent");
  });
});

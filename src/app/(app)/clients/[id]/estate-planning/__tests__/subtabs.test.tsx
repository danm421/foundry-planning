// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

import { usePathname, useSearchParams } from "next/navigation";
import EstatePlanningSubtabs from "../subtabs";

beforeEach(() => {
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams() as unknown as ReturnType<typeof useSearchParams>,
  );
});

describe("EstatePlanningSubtabs", () => {
  it("renders all four sub-tabs in order: Planning, Estate Tax, Estate Transfer, Gift Tax", () => {
    vi.mocked(usePathname).mockReturnValue("/clients/c1/estate-planning");
    const { container } = render(<EstatePlanningSubtabs clientId="c1" />);
    const text = container.textContent ?? "";
    const expected = ["Planning", "Estate Tax", "Estate Transfer", "Gift Tax"];
    let last = -1;
    for (const label of expected) {
      const idx = text.indexOf(label);
      expect(idx).toBeGreaterThan(last);
      last = idx;
    }
  });

  it("renders four anchor tags with the expected hrefs", () => {
    vi.mocked(usePathname).mockReturnValue("/clients/c1/estate-planning");
    const { container } = render(<EstatePlanningSubtabs clientId="c1" />);
    const links = Array.from(container.querySelectorAll("a"));
    expect(links).toHaveLength(4);
    expect(links[0].getAttribute("href")).toBe("/clients/c1/estate-planning");
    expect(links[1].getAttribute("href")).toBe("/clients/c1/estate-planning/estate-tax");
    expect(links[2].getAttribute("href")).toBe("/clients/c1/estate-planning/estate-transfer");
    expect(links[3].getAttribute("href")).toBe("/clients/c1/estate-planning/gift-tax");
  });

  it("marks Planning active on the exact /estate-planning path", () => {
    vi.mocked(usePathname).mockReturnValue("/clients/c1/estate-planning");
    const { container } = render(<EstatePlanningSubtabs clientId="c1" />);
    const planning = Array.from(container.querySelectorAll("a")).find(
      (a) => a.textContent?.trim() === "Planning",
    );
    expect(planning?.className).toContain("border-accent");
    expect(planning?.getAttribute("aria-selected")).toBe("true");
  });

  it("does NOT mark Planning active when on a sub-route (no false positive from prefix match)", () => {
    vi.mocked(usePathname).mockReturnValue("/clients/c1/estate-planning/estate-tax");
    const { container } = render(<EstatePlanningSubtabs clientId="c1" />);
    const planning = Array.from(container.querySelectorAll("a")).find(
      (a) => a.textContent?.trim() === "Planning",
    );
    expect(planning?.getAttribute("aria-selected")).not.toBe("true");
    expect(planning?.className).not.toContain("border-accent");
  });

  it.each([
    ["Estate Tax", "/clients/c1/estate-planning/estate-tax"],
    ["Estate Transfer", "/clients/c1/estate-planning/estate-transfer"],
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
    vi.mocked(usePathname).mockReturnValue("/clients/c1/estate-planning");
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams("scenario=sc-1") as unknown as ReturnType<typeof useSearchParams>,
    );
    const { container } = render(<EstatePlanningSubtabs clientId="c1" />);
    const links = Array.from(container.querySelectorAll("a"));
    for (const a of links) {
      expect(a.getAttribute("href")).toContain("?scenario=sc-1");
    }
  });

  it("renders a sticky nav so it pins below the top-level tab strip", () => {
    vi.mocked(usePathname).mockReturnValue("/clients/c1/estate-planning");
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

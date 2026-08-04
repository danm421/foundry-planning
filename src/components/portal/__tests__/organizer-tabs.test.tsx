// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

let mockPathname = "/portal/organizer";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

import OrganizerTabs from "../organizer-tabs";

describe("OrganizerTabs", () => {
  it("renders the four Organizer tabs", () => {
    mockPathname = "/portal/organizer";
    const { container } = render(<OrganizerTabs />);
    const links = Array.from(container.querySelectorAll("a"));
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/portal/organizer",
      "/portal/organizer/accounts",
      "/portal/organizer/goals",
      "/portal/organizer/cash-flow",
    ]);
    expect(links.map((a) => a.textContent)).toEqual([
      "Household",
      "Accounts",
      "Goals",
      "Cash Flow",
    ]);
  });

  it("marks the section index current only on the index route", () => {
    mockPathname = "/portal/organizer";
    const { container } = render(<OrganizerTabs />);
    const current = container.querySelectorAll('a[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute("href", "/portal/organizer");
  });

  it("marks a nested tab current without also marking the index", () => {
    mockPathname = "/portal/organizer/cash-flow";
    const { container } = render(<OrganizerTabs />);
    const current = container.querySelectorAll('a[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute("href", "/portal/organizer/cash-flow");
  });

  it("prefixes every tab with a provided basePath (advisor preview)", () => {
    mockPathname = "/clients/c1/portal/preview/organizer/goals";
    const { container } = render(<OrganizerTabs basePath="/clients/c1/portal/preview" />);
    expect(
      Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href")),
    ).toEqual([
      "/clients/c1/portal/preview/organizer",
      "/clients/c1/portal/preview/organizer/accounts",
      "/clients/c1/portal/preview/organizer/goals",
      "/clients/c1/portal/preview/organizer/cash-flow",
    ]);
    const current = container.querySelectorAll('a[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute("href", "/clients/c1/portal/preview/organizer/goals");
  });
});

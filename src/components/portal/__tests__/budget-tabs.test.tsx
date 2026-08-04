// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

let mockPathname = "/portal/budget";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

import BudgetTabs from "../budget-tabs";

describe("BudgetTabs", () => {
  it("renders the three Budget tabs under /portal/budget", () => {
    mockPathname = "/portal/budget";
    const { container } = render(<BudgetTabs />);
    const links = Array.from(container.querySelectorAll("a"));
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/portal/budget",
      "/portal/budget/transactions",
      "/portal/budget/recurring",
    ]);
    expect(links.map((a) => a.textContent)).toEqual([
      "Budget",
      "Transactions",
      "Recurring",
    ]);
  });

  it("marks the section index current only on the index route", () => {
    mockPathname = "/portal/budget";
    const { container } = render(<BudgetTabs />);
    const current = container.querySelectorAll('a[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute("href", "/portal/budget");
  });

  it("marks a nested tab current without also marking the index", () => {
    mockPathname = "/portal/budget/recurring";
    const { container } = render(<BudgetTabs />);
    const current = container.querySelectorAll('a[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute("href", "/portal/budget/recurring");
  });

  it("prefixes every tab with a provided basePath (advisor preview)", () => {
    mockPathname = "/clients/c1/portal/preview/budget/transactions";
    const { container } = render(
      <BudgetTabs basePath="/clients/c1/portal/preview" />,
    );
    expect(
      Array.from(container.querySelectorAll("a")).map((a) =>
        a.getAttribute("href"),
      ),
    ).toEqual([
      "/clients/c1/portal/preview/budget",
      "/clients/c1/portal/preview/budget/transactions",
      "/clients/c1/portal/preview/budget/recurring",
    ]);
    const current = container.querySelectorAll('a[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute(
      "href",
      "/clients/c1/portal/preview/budget/transactions",
    );
  });
});

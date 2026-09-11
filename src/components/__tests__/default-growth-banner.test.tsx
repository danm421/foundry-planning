// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DefaultGrowthBanner } from "@/components/default-growth-banner";

describe("DefaultGrowthBanner", () => {
  it("renders nothing when the plan has real return assumptions", () => {
    const { container } = render(
      <DefaultGrowthBanner clientId="c1" warning={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("names the categories, the balance, the rate, and links to the growth tab", () => {
    render(
      <DefaultGrowthBanner
        clientId="c1"
        warning={{
          categories: ["taxable", "retirement"],
          accountCount: 4,
          totalValue: 4_210_000,
          rate: 0.025,
        }}
      />,
    );

    const banner = screen.getByRole("status");
    expect(banner.textContent).toContain("4 taxable and retirement accounts");
    expect(banner.textContent).toContain("$4,210,000");
    expect(banner.textContent).toContain("2.5%");

    expect(screen.getByRole("link", { name: "Set growth rates" })).toHaveAttribute(
      "href",
      "/clients/c1/details/assumptions?tab=growth-inflation",
    );
  });

  it("says 'account' when only one account inherits the default", () => {
    render(
      <DefaultGrowthBanner
        clientId="c1"
        warning={{
          categories: ["retirement"],
          accountCount: 1,
          totalValue: 500_000,
          rate: 0.03,
        }}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("1 retirement account ");
  });
});

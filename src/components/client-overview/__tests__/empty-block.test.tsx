// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import EmptyBlock from "../empty-block";

describe("EmptyBlock", () => {
  it("renders title, body, and CTA with correct href", () => {
    render(
      <EmptyBlock
        icon={<svg data-testid="icon" />}
        title="No projection yet"
        body="Run the cash-flow projection to populate this block."
        cta={{ href: "/clients/abc/cashflow", label: "Run a projection" }}
      />,
    );
    expect(screen.getByText("No projection yet")).toBeInTheDocument();
    expect(
      screen.getByText("Run the cash-flow projection to populate this block."),
    ).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Run a projection/ });
    expect(link).toHaveAttribute("href", "/clients/abc/cashflow");
    expect(screen.getByTestId("icon")).toBeInTheDocument();
  });

  it("renders without body when body is undefined", () => {
    render(
      <EmptyBlock
        icon={<svg />}
        title="Empty"
        cta={{ href: "/x", label: "Go" }}
      />,
    );
    expect(screen.getByText("Empty")).toBeInTheDocument();
  });
});

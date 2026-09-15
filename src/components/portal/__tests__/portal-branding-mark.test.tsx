// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PortalBrandingStrip } from "../portal-branding-mark";

describe("PortalBrandingStrip", () => {
  it("hosts the mark and honors a visibility className override", () => {
    const { container } = render(
      <PortalBrandingStrip branding={null} className="hidden lg:flex" />,
    );
    const strip = container.firstElementChild;
    expect(strip?.className).toContain("hidden lg:flex");
    expect(
      screen.getByRole("img", { name: "Foundry Planning" }),
    ).toBeInTheDocument();
  });

  it("greets the household beside the mark, on one line", () => {
    const { container } = render(
      <PortalBrandingStrip
        branding={null}
        displayName="John Cooper & Jane Cooper"
      />,
    );
    // One text node, not a stacked eyebrow-over-name block: the bar is a row.
    expect(container).toHaveTextContent("Welcome back, John Cooper & Jane Cooper");
  });

  it("renders a nameless welcome — not a dangling comma — with no name", () => {
    const { container } = render(<PortalBrandingStrip branding={null} />);
    expect(container).toHaveTextContent("Welcome back");
    expect(container.textContent).not.toContain("Welcome back,");
  });
});

// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import PortalBrandingMark, {
  PortalBrandingStrip,
} from "../portal-branding-mark";

describe("PortalBrandingMark", () => {
  it("renders the firm logo with the firm name as alt when branded", () => {
    render(
      <PortalBrandingMark
        branding={{
          logoUrl: "https://blob.example/logo.png",
          firmName: "Acme Wealth",
        }}
      />,
    );
    const img = screen.getByRole("img", { name: "Acme Wealth" });
    expect(img).toHaveAttribute("src", "https://blob.example/logo.png");
  });

  it("falls back to the Foundry lockup when branding is null", () => {
    render(<PortalBrandingMark branding={null} />);
    const img = screen.getByRole("img", { name: "Foundry Planning" });
    expect(img).toHaveAttribute("src", "/brand/lockup-horizontal.svg");
  });
});

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
});

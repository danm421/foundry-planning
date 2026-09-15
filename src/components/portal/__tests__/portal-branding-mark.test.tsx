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
});

// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { IntakeBrandingHeader } from "../branding-header";

describe("IntakeBrandingHeader", () => {
  it("renders the firm logo with the firm name as alt when branded", () => {
    render(
      <IntakeBrandingHeader
        branding={{
          logoUrl: "https://cdn.example/logo.png",
          firmName: "Acme Wealth",
        }}
      />,
    );
    const img = screen.getByRole("img", { name: "Acme Wealth" });
    expect(img).toHaveAttribute("src", "https://cdn.example/logo.png");
  });

  it("renders the Foundry lockup when branding is absent", () => {
    render(<IntakeBrandingHeader />);
    const img = screen.getByRole("img", { name: "Foundry Planning" });
    expect(img).toHaveAttribute("src", "/brand/lockup-horizontal.svg");
  });
});

// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import FirmMark from "../firm-mark";

const ACME = {
  logoUrl: "https://blob.example/logo.png",
  firmName: "Acme Wealth",
};

describe("FirmMark", () => {
  it("renders the firm logo with the firm name as alt when branded", () => {
    render(<FirmMark branding={ACME} />);
    const img = screen.getByRole("img", { name: "Acme Wealth" });
    expect(img).toHaveAttribute("src", "https://blob.example/logo.png");
  });

  it("falls back to the Foundry lockup when branding is null", () => {
    render(<FirmMark branding={null} />);
    const img = screen.getByRole("img", { name: "Foundry Planning" });
    expect(img).toHaveAttribute("src", "/brand/lockup-horizontal.svg");
  });

  // Why the plate exists: see `--color-letterhead` in globals.css.
  it("stands the firm logo on a letterhead plate", () => {
    render(<FirmMark branding={ACME} />);
    const img = screen.getByRole("img", { name: "Acme Wealth" });
    expect(img.parentElement?.className).toContain("bg-letterhead");
  });

  it("does not plate the Foundry lockup", () => {
    render(<FirmMark branding={null} />);
    const img = screen.getByRole("img", { name: "Foundry Planning" });
    expect(img.parentElement?.className ?? "").not.toContain("bg-letterhead");
  });
});

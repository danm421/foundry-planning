// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/portal",
}));
vi.mock("@clerk/nextjs", () => ({
  UserButton: () => null,
}));

import PortalNav from "../portal-nav";
import PortalMobileNav from "../portal-mobile-nav";

describe("PortalNav welcome line", () => {
  it("leaves the greeting to the letterhead — the rail must not greet twice", () => {
    // Desktop renders the rail and the letterhead bar together, so a greeting
    // left here would put two "Welcome back"s on one screen.
    const { container } = render(<PortalNav editEnabled={false} />);
    expect(container.textContent).not.toContain("Welcome");
    // Positive control: the rail did render.
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
  });
});

describe("PortalMobileNav welcome line", () => {
  it("greets the household in the top bar", () => {
    Element.prototype.scrollIntoView = vi.fn();
    window.matchMedia ??= (() =>
      ({ matches: false }) as unknown as MediaQueryList) as typeof window.matchMedia;
    render(<PortalMobileNav displayName="John & Jane" />);
    expect(screen.getByText("Welcome back, John & Jane")).toBeInTheDocument();
  });
});

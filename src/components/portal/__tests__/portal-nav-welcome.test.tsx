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
  it("greets the household by name above the email", () => {
    render(<PortalNav displayName="John & Jane" email="john@cooper.test" />);
    expect(screen.getByText("Welcome,")).toBeInTheDocument();
    expect(screen.getByText("John & Jane")).toBeInTheDocument();
    expect(screen.getByText("john@cooper.test")).toBeInTheDocument();
  });

  it("renders a nameless welcome — not a dangling comma — when no name resolved", () => {
    render(<PortalNav displayName="" email="" />);
    expect(screen.getByText("Welcome")).toBeInTheDocument();
    expect(screen.queryByText("Welcome,")).not.toBeInTheDocument();
  });
});

describe("PortalMobileNav welcome line", () => {
  it("greets the household in the top bar", () => {
    Element.prototype.scrollIntoView = vi.fn();
    window.matchMedia ??= (() =>
      ({ matches: false }) as unknown as MediaQueryList) as typeof window.matchMedia;
    render(<PortalMobileNav displayName="John & Jane" />);
    expect(screen.getByText("Welcome, John & Jane")).toBeInTheDocument();
  });
});

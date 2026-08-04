// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";

let mockPathname = "/portal/accounts";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));
vi.mock("@clerk/nextjs", () => ({
  UserButton: () => null,
}));

import PortalMobileNav from "../portal-mobile-nav";

beforeAll(() => {
  // jsdom implements neither — the component calls both on mount.
  if (!window.matchMedia) {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList;
  }
  Element.prototype.scrollIntoView = vi.fn();
});

describe("PortalMobileNav", () => {
  it("renders all six portal destinations as links (default /portal basePath)", () => {
    mockPathname = "/portal/organizer";
    const { container } = render(<PortalMobileNav displayName="Jane Doe" />);
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) =>
      a.getAttribute("href"),
    );
    // Household, Family, Trusts and Accounts are tabs inside Organizer, and
    // Transactions and Recurring are tabs inside Budget — none are rail
    // destinations.
    expect(hrefs).toEqual([
      "/portal",
      "/portal/organizer",
      "/portal/investments",
      "/portal/budget",
      "/portal/documents",
      "/portal/settings",
    ]);
  });

  it("prefixes links with a provided basePath (advisor preview)", () => {
    mockPathname = "/clients/c1/portal/preview/organizer";
    const { container } = render(
      <PortalMobileNav displayName="Jane" basePath="/clients/c1/portal/preview" />,
    );
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs).toContain("/clients/c1/portal/preview/budget");
    expect(hrefs).toContain("/clients/c1/portal/preview/organizer");
  });

  it("marks only the current route with aria-current=page", () => {
    mockPathname = "/portal/budget";
    const { container } = render(<PortalMobileNav displayName="Jane" />);
    const current = container.querySelectorAll('a[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute("href", "/portal/budget");
  });

  it("keeps Budget current on its nested tab routes", () => {
    mockPathname = "/portal/budget/transactions";
    const { container } = render(<PortalMobileNav displayName="Jane" />);
    const current = container.querySelectorAll('a[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute("href", "/portal/budget");
  });

  it("keeps Organizer current on its nested tab routes", () => {
    mockPathname = "/portal/organizer/accounts";
    const { container } = render(<PortalMobileNav displayName="Jane" />);
    const current = container.querySelectorAll('a[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute("href", "/portal/organizer");
  });

  it("does not mark a leaf destination current on a route nested under it", () => {
    // Investments has no matchNested, so a deeper path under its suffix must
    // NOT light it up — pins the false branch of isPortalNavItemActive's
    // `item.matchNested === true && pathname.startsWith(...)` guard.
    mockPathname = "/portal/investments/foo";
    const { container } = render(<PortalMobileNav displayName="Jane" />);
    expect(container.querySelectorAll('a[aria-current="page"]')).toHaveLength(0);
  });

  it("falls back to a generic title when displayName is empty", () => {
    mockPathname = "/portal/profile";
    render(<PortalMobileNav displayName="" />);
    expect(screen.getByText("Your portal")).toBeInTheDocument();
  });

  it("renders the firm logo next to the account button when branding is provided", () => {
    mockPathname = "/portal";
    render(
      <PortalMobileNav
        displayName="Jane"
        branding={{
          logoUrl: "https://blob.example/logo.png",
          firmName: "Acme Wealth",
        }}
      />,
    );
    const img = screen.getByRole("img", { name: "Acme Wealth" });
    expect(img).toHaveAttribute("src", "https://blob.example/logo.png");
  });

  it("shows the Foundry lockup when the firm has no branding", () => {
    mockPathname = "/portal";
    render(<PortalMobileNav displayName="Jane" />);
    expect(
      screen.getByRole("img", { name: "Foundry Planning" }),
    ).toBeInTheDocument();
  });

  it("renders an attention dot only on the alerted item", () => {
    mockPathname = "/portal/accounts";
    const { container } = render(
      <PortalMobileNav displayName="Jane" alerts={{ "/settings": true }} />,
    );
    const dots = container.querySelectorAll('[aria-label="Needs attention"]');
    expect(dots).toHaveLength(1);
    const settingsLink = container.querySelector('a[href="/portal/settings"]');
    expect(
      settingsLink?.querySelector('[aria-label="Needs attention"]'),
    ).toBeTruthy();
  });

  it("renders no attention dot when alerts is omitted (default {})", () => {
    mockPathname = "/portal/accounts";
    const { container } = render(<PortalMobileNav displayName="Jane" />);
    expect(
      container.querySelectorAll('[aria-label="Needs attention"]'),
    ).toHaveLength(0);
  });
});

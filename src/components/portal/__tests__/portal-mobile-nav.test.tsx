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
    mockPathname = "/portal/accounts";
    const { container } = render(<PortalMobileNav displayName="Jane Doe" />);
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs).toEqual([
      "/portal/profile",
      "/portal/profile/family",
      "/portal/profile/trusts",
      "/portal/accounts",
      "/portal/transactions",
      "/portal/budget",
    ]);
  });

  it("prefixes links with a provided basePath (advisor preview)", () => {
    mockPathname = "/clients/c1/portal/preview/accounts";
    const { container } = render(
      <PortalMobileNav displayName="Jane" basePath="/clients/c1/portal/preview" />,
    );
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs).toContain("/clients/c1/portal/preview/transactions");
    expect(hrefs).toContain("/clients/c1/portal/preview/profile");
  });

  it("marks only the current route with aria-current=page", () => {
    mockPathname = "/portal/budget";
    const { container } = render(<PortalMobileNav displayName="Jane" />);
    const current = container.querySelectorAll('a[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute("href", "/portal/budget");
  });

  it("falls back to a generic title when displayName is empty", () => {
    mockPathname = "/portal/profile";
    render(<PortalMobileNav displayName="" />);
    expect(screen.getByText("Your portal")).toBeInTheDocument();
  });
});

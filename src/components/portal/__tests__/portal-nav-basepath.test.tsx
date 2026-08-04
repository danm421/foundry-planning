// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/clients/c1/portal/preview",
}));
vi.mock("@clerk/nextjs", () => ({
  UserButton: () => null,
}));

import PortalNav from "../portal-nav";

describe("PortalNav basePath", () => {
  it("defaults to /portal when basePath is omitted (backwards compat)", () => {
    const { container } = render(<PortalNav displayName="A" email="a@b.co" />);
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs).toEqual(
      expect.arrayContaining(["/portal/organizer", "/portal/investments"]),
    );
  });

  it("prefixes all nav links with the provided basePath", () => {
    const { container } = render(
      <PortalNav
        displayName="A"
        email="a@b.co"
        basePath="/clients/c1/portal/preview"
      />,
    );
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs).toEqual(
      expect.arrayContaining([
        "/clients/c1/portal/preview/organizer",
        "/clients/c1/portal/preview/investments",
      ]),
    );
  });

  it("renders a Dashboard link resolving to the base path", () => {
    render(<PortalNav displayName="A" email="a@b.c" basePath="/portal" />);
    const link = screen.getByRole("link", { name: "Dashboard" });
    expect(link).toHaveAttribute("href", "/portal");
  });

  it("resolves Dashboard under the advisor preview base path", () => {
    render(
      <PortalNav displayName="A" email="a@b.c" basePath="/clients/abc/portal/preview" />,
    );
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "href",
      "/clients/abc/portal/preview",
    );
  });

  it("renders an attention dot only on the alerted item", () => {
    const { container } = render(
      <PortalNav displayName="A" email="a@b.co" alerts={{ "/settings": true }} />,
    );
    const dots = container.querySelectorAll('[aria-label="Needs attention"]');
    expect(dots).toHaveLength(1);
    const settingsLink = container.querySelector('a[href="/portal/settings"]');
    expect(
      settingsLink?.querySelector('[aria-label="Needs attention"]'),
    ).toBeTruthy();
  });

  it("renders no attention dot when alerts is omitted (default {})", () => {
    const { container } = render(<PortalNav displayName="A" email="a@b.co" />);
    expect(
      container.querySelectorAll('[aria-label="Needs attention"]'),
    ).toHaveLength(0);
  });

  it("renders no attention dot when the alert is explicitly false", () => {
    const { container } = render(
      <PortalNav displayName="A" email="a@b.co" alerts={{ "/settings": false }} />,
    );
    expect(
      container.querySelectorAll('[aria-label="Needs attention"]'),
    ).toHaveLength(0);
  });

  it("renders exactly the six rail destinations", () => {
    const { container } = render(<PortalNav displayName="A" email="a@b.co" />);
    expect(
      Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href")),
    ).toEqual([
      "/portal",
      "/portal/organizer",
      "/portal/investments",
      "/portal/budget",
      "/portal/documents",
      "/portal/settings",
    ]);
  });

  it("renders no group subheader now that Profile is gone", () => {
    const { container } = render(<PortalNav displayName="A" email="a@b.co" />);
    expect(container.textContent).not.toContain("Profile");
  });
});

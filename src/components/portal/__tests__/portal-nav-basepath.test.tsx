// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

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
      expect.arrayContaining([
        "/portal/profile",
        "/portal/profile/family",
        "/portal/profile/trusts",
        "/portal/accounts",
      ]),
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
        "/clients/c1/portal/preview/profile",
        "/clients/c1/portal/preview/profile/family",
        "/clients/c1/portal/preview/profile/trusts",
        "/clients/c1/portal/preview/accounts",
      ]),
    );
  });
});

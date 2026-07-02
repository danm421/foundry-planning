// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(),
  useSearchParams: vi.fn(() => new URLSearchParams()),
  useRouter: vi.fn(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() })),
}));

vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({ user: null, isLoaded: true, isSignedIn: false }),
}));

import { usePathname, useSearchParams } from "next/navigation";
import Topbar from "../topbar";
import { BackNavProvider } from "../back-nav-provider";

beforeEach(() => {
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams() as unknown as ReturnType<typeof useSearchParams>,
  );
});

describe("Topbar", () => {
  it("renders a sticky header", () => {
    vi.mocked(usePathname).mockReturnValue("/clients");
    const { container } = render(<Topbar />);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain("sticky");
    expect(el.className).toContain("top-0");
  });

  it("renders the breadcrumb in the left slot", () => {
    vi.mocked(usePathname).mockReturnValue("/clients");
    const { container } = render(<Topbar />);
    expect(container.textContent).toContain("Clients");
  });

  it("does not render report tabs outside a client route", () => {
    vi.mocked(usePathname).mockReturnValue("/cma");
    const { container } = render(<Topbar />);
    expect(container.querySelector("nav[role='tablist']")).toBeNull();
  });

  it("renders the top-level tabs in order on a client route", () => {
    vi.mocked(usePathname).mockReturnValue("/clients/c1/details");
    const { container } = render(
      <BackNavProvider>
        <Topbar />
      </BackNavProvider>,
    );
    const text = container.textContent ?? "";
    // Overview is intentionally hidden for now (see topbar TABS); planning
    // lands on Details instead.
    const expected = [
      "Details",
      "Assets",
      "Cash Flow",
      "Estate Planning",
      "Comparison",
    ];
    let last = -1;
    for (const label of expected) {
      const idx = text.indexOf(label);
      expect(idx).toBeGreaterThan(last);
      last = idx;
    }
    // Overview must not appear as a tab anywhere in the header.
    expect(text).not.toContain("Overview");
  });

  it("marks the active tab based on pathname", () => {
    vi.mocked(usePathname).mockReturnValue("/clients/c1/cashflow");
    const { container } = render(<Topbar />);
    const cashflow = Array.from(container.querySelectorAll("a")).find(
      (a) => a.textContent?.trim() === "Cash Flow",
    );
    expect(cashflow?.getAttribute("aria-selected")).toBe("true");
    expect(cashflow?.className).toContain("border-accent");
  });

  it("preserves ?scenario= on every tab href when active", () => {
    vi.mocked(usePathname).mockReturnValue("/clients/c1/details");
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams("scenario=sc-1") as unknown as ReturnType<typeof useSearchParams>,
    );
    const { container } = render(<Topbar />);
    const links = Array.from(container.querySelectorAll("a"));
    expect(links.length).toBeGreaterThanOrEqual(7);
    for (const a of links) {
      expect(a.getAttribute("href")).toContain("?scenario=sc-1");
    }
  });

  it("renders sub-tab links in a hover menu for tabs that have sub-reports", () => {
    vi.mocked(usePathname).mockReturnValue("/clients/c1/details");
    const { container } = render(<Topbar />);
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) =>
      a.getAttribute("href") ?? "",
    );
    expect(hrefs).toEqual(
      expect.arrayContaining([
        expect.stringContaining("/clients/c1/cashflow/income-tax"),
        expect.stringContaining("/clients/c1/cashflow/monte-carlo"),
        expect.stringContaining("/clients/c1/cashflow/timeline"),
        expect.stringContaining("/clients/c1/assets/balance-sheet-report"),
        expect.stringContaining("/clients/c1/assets/investments"),
        expect.stringContaining("/clients/c1/estate-planning/estate-tax"),
      ]),
    );
    const menus = container.querySelectorAll("[role='menu']");
    // Assets, Cash Flow, Analysis, Estate Planning each render a sub-tab menu.
    expect(menus.length).toBe(4);
  });

  it("exposes a sub-report's views in a nested flyout (Ledgers → Asset/Tax Ledger)", () => {
    vi.mocked(usePathname).mockReturnValue("/clients/c1/cashflow/ledgers/asset-ledger");
    // Wrapped in BackNavProvider so BackButton's useBackNav resolves; the rest of
    // this suite predates that provider and is independently stale.
    const { container } = render(
      <BackNavProvider>
        <Topbar />
      </BackNavProvider>,
    );
    const byText = (label: string) =>
      Array.from(container.querySelectorAll("a")).find((a) => a.textContent?.trim() === label);

    // The Ledgers sub-report stays navigable and advertises its flyout.
    const ledgers = byText("Ledgers");
    expect(ledgers?.getAttribute("aria-haspopup")).toBe("menu");
    expect(ledgers?.getAttribute("href")).toContain("/clients/c1/cashflow/ledgers");
    expect(ledgers?.className).toContain("text-accent"); // active on a child route

    // Both views are present with their nested hrefs.
    expect(byText("Asset Ledger")?.getAttribute("href")).toContain(
      "/clients/c1/cashflow/ledgers/asset-ledger",
    );
    expect(byText("Tax Ledger")?.getAttribute("href")).toContain(
      "/clients/c1/cashflow/ledgers/tax-ledger",
    );

    // The active view is highlighted; the inactive one is not.
    expect(byText("Asset Ledger")?.className).toContain("text-accent");
    expect(byText("Tax Ledger")?.className).not.toContain("text-accent");

    expect(container.querySelector("[role='menu'][aria-label='Ledgers views']")).not.toBeNull();
  });

  it("exposes a sub-report's query-param views in a nested flyout (Estate Tax → Estate Tax/State Death Tax)", () => {
    vi.mocked(usePathname).mockReturnValue("/clients/c1/estate-planning/estate-tax");
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams("view=state") as unknown as ReturnType<typeof useSearchParams>,
    );
    const { container } = render(
      <BackNavProvider>
        <Topbar />
      </BackNavProvider>,
    );

    // The nested view menu carries both views with their `?view=` hrefs. Scope to the
    // menu so the default view's "Estate Tax" link isn't confused with the parent trigger.
    const viewsMenu = container.querySelector("[role='menu'][aria-label='Estate Tax views']");
    expect(viewsMenu).not.toBeNull();
    const viewLink = (label: string) =>
      Array.from(viewsMenu!.querySelectorAll("a")).find((a) => a.textContent?.trim() === label);

    expect(viewLink("Estate Tax")?.getAttribute("href")).toContain(
      "/clients/c1/estate-planning/estate-tax?view=estate",
    );
    expect(viewLink("State Death Tax")?.getAttribute("href")).toContain(
      "/clients/c1/estate-planning/estate-tax?view=state",
    );

    // `?view=state` → State Death Tax is the active view; the default (estate) is not.
    expect(viewLink("State Death Tax")?.className).toContain("text-accent");
    expect(viewLink("Estate Tax")?.className).not.toContain("text-accent");
  });

  it("renders Portal tab linking to /clients/:id/portal", () => {
    vi.mocked(usePathname).mockReturnValue("/clients/c1/overview");
    const { container } = render(
      <BackNavProvider>
        <Topbar />
      </BackNavProvider>,
    );
    const link = Array.from(container.querySelectorAll("a[role='tab']")).find(
      (a) => a.textContent?.trim() === "Portal",
    );
    expect(link).toBeTruthy();
    expect(link?.getAttribute("href")).toContain("/clients/c1/portal");
  });

  it("highlights a query-param sub-report's default view when ?view= is absent", () => {
    vi.mocked(usePathname).mockReturnValue("/clients/c1/estate-planning/estate-tax");
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams() as unknown as ReturnType<typeof useSearchParams>,
    );
    const { container } = render(
      <BackNavProvider>
        <Topbar />
      </BackNavProvider>,
    );
    const viewsMenu = container.querySelector("[role='menu'][aria-label='Estate Tax views']")!;
    const viewLink = (label: string) =>
      Array.from(viewsMenu.querySelectorAll("a")).find((a) => a.textContent?.trim() === label);

    // Bare report URL → the defaultView ("estate") highlights; State Death Tax does not.
    expect(viewLink("Estate Tax")?.className).toContain("text-accent");
    expect(viewLink("State Death Tax")?.className).not.toContain("text-accent");
  });
});

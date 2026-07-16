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

/**
 * `Topbar` renders `BackButton`, whose `useBackNav` throws outside the
 * provider. Every case must render through this helper.
 */
function renderTopbar() {
  return render(
    <BackNavProvider>
      <Topbar />
    </BackNavProvider>,
  );
}

describe("Topbar", () => {
  it("renders a sticky header", () => {
    vi.mocked(usePathname).mockReturnValue("/clients");
    const { container } = renderTopbar();
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain("sticky");
    expect(el.className).toContain("top-0");
  });

  it("renders the breadcrumb in the left slot", () => {
    vi.mocked(usePathname).mockReturnValue("/clients");
    const { container } = renderTopbar();
    expect(container.textContent).toContain("Clients");
  });

  it("does not render report tabs outside a client route", () => {
    vi.mocked(usePathname).mockReturnValue("/cma");
    const { container } = renderTopbar();
    expect(container.querySelector("nav[role='tablist']")).toBeNull();
  });

  it("renders the primary trio, a divider, then the secondary trio", () => {
    vi.mocked(usePathname).mockReturnValue("/clients/c1/details");
    const { container } = renderTopbar();
    const nav = container.querySelector("nav[role='tablist']")!;

    // Scope to the nav: the Portal link also carries role="tab" but renders in
    // the header's right slot, so an unscoped query trails "Portal" onto this list.
    const labels = Array.from(nav.querySelectorAll("[role='tab']")).map((a) =>
      a.textContent?.trim(),
    );
    expect(labels).toEqual([
      "Details",
      "Solver",
      "Presentations",
      "Assets",
      "Cash Flow",
      "Estate",
    ]);

    // Overview is intentionally hidden (see topbar PRIMARY_TABS); planning
    // lands on Details instead.
    expect(container.textContent).not.toContain("Overview");
  });

  it("separates the two groups with exactly one hairline divider", () => {
    vi.mocked(usePathname).mockReturnValue("/clients/c1/details");
    const { container } = renderTopbar();
    const nav = container.querySelector("nav[role='tablist']")!;

    const dividers = nav.querySelectorAll("span[class~='w-px']");
    expect(dividers.length).toBe(1);
    expect(dividers[0].className).toContain("bg-hair");
    expect(dividers[0].getAttribute("aria-hidden")).toBe("true");

    // It sits after the three primary tabs, not anywhere else in the row.
    const kids = Array.from(nav.children);
    const dividerIdx = kids.findIndex((el) => el.className.includes("w-px"));
    expect(dividerIdx).toBe(3);
  });

  it("gives the primary trio 13px and the secondary trio 12px", () => {
    vi.mocked(usePathname).mockReturnValue("/clients/c1/details");
    const { container } = renderTopbar();
    const nav = container.querySelector("nav[role='tablist']")!;
    // Exact-token match on the class list: `toContain` on the raw string would
    // also match text-ink-2 / text-ink-3, so it could never fail.
    const classes = (label: string) =>
      Array.from(nav.querySelectorAll("[role='tab']"))
        .find((a) => a.textContent?.trim() === label)!
        .className.split(/\s+/);

    // Details is active on this route, so assert the inactive primaries.
    expect(classes("Solver")).toContain("text-[13px]");
    expect(classes("Solver")).toContain("text-ink");
    expect(classes("Solver")).toContain("font-medium");
    expect(classes("Presentations")).toContain("text-[13px]");

    expect(classes("Assets")).toContain("text-[12px]");
    expect(classes("Assets")).toContain("text-ink-3");
    expect(classes("Cash Flow")).toContain("text-[12px]");
    expect(classes("Estate")).toContain("text-[12px]");
  });

  it("keeps an active secondary tab at 12px so the row does not reflow", () => {
    vi.mocked(usePathname).mockReturnValue("/clients/c1/cashflow");
    const { container } = renderTopbar();
    const nav = container.querySelector("nav[role='tablist']")!;
    const cashflow = Array.from(nav.querySelectorAll("[role='tab']")).find(
      (a) => a.textContent?.trim() === "Cash Flow",
    )!;

    expect(cashflow.className).toContain("border-accent");
    expect(cashflow.className).toContain("text-accent");
    // The active pill must not jump to the primary size tier.
    expect(cashflow.className).toContain("text-[12px]");
    expect(cashflow.className).not.toContain("text-[13px]");
  });

  it("marks only the flyout-owning tabs with a chevron", () => {
    vi.mocked(usePathname).mockReturnValue("/clients/c1/details");
    const { container } = renderTopbar();
    const nav = container.querySelector("nav[role='tablist']")!;
    const chevron = (label: string) =>
      Array.from(nav.querySelectorAll("[role='tab']"))
        .find((a) => a.textContent?.trim() === label)!
        .querySelector("svg");

    for (const label of ["Assets", "Cash Flow", "Estate"]) {
      expect(chevron(label)).not.toBeNull();
      expect(chevron(label)?.getAttribute("aria-hidden")).toBe("true");
    }
    for (const label of ["Details", "Solver", "Presentations"]) {
      expect(chevron(label)).toBeNull();
    }
  });

  it("marks the active tab based on pathname", () => {
    vi.mocked(usePathname).mockReturnValue("/clients/c1/cashflow");
    const { container } = renderTopbar();
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
    const { container } = renderTopbar();
    const links = Array.from(container.querySelectorAll("a"));
    expect(links.length).toBeGreaterThanOrEqual(7);
    for (const a of links) {
      // Parse rather than substring-match: a link that already carries its own
      // query (e.g. ?view=household) gets "&scenario=", never "?scenario=".
      const [, query = ""] = (a.getAttribute("href") ?? "").split("?");
      expect(new URLSearchParams(query).get("scenario")).toBe("sc-1");
    }
  });

  it("renders sub-tab links in a hover menu for tabs that have sub-reports", () => {
    vi.mocked(usePathname).mockReturnValue("/clients/c1/details");
    const { container } = renderTopbar();
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
    // Exactly three top-level tabs own a sub-tab menu. Nested "<sub> views"
    // menus are asserted by the flyout tests and deliberately excluded here.
    const sectionMenus = container.querySelectorAll("[role='menu'][aria-label$=' sections']");
    expect(sectionMenus.length).toBe(3);
  });

  it("exposes a sub-report's views in a nested flyout (Ledgers → Asset/Tax Ledger)", () => {
    vi.mocked(usePathname).mockReturnValue("/clients/c1/cashflow/ledgers/asset-ledger");
    const { container } = renderTopbar();
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
    const { container } = renderTopbar();

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
    const { container } = renderTopbar();
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
    const { container } = renderTopbar();
    const viewsMenu = container.querySelector("[role='menu'][aria-label='Estate Tax views']")!;
    const viewLink = (label: string) =>
      Array.from(viewsMenu.querySelectorAll("a")).find((a) => a.textContent?.trim() === label);

    // Bare report URL → the defaultView ("estate") highlights; State Death Tax does not.
    expect(viewLink("Estate Tax")?.className).toContain("text-accent");
    expect(viewLink("State Death Tax")?.className).not.toContain("text-accent");
  });
});

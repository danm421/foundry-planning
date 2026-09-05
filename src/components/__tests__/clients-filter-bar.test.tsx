// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const replace = vi.fn();

/**
 * Mutable so each test seeds the URL it needs; `afterEach` clears it so a test
 * that forgets to seed can't silently inherit the previous test's URL.
 */
let search = "";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/clients",
  useSearchParams: () => new URLSearchParams(search),
}));

import { ClientsFilterBar } from "../clients-filter-bar";

const DEFAULT_SEARCH = "view=all&sort=name&dir=asc&take=500";

function renderBar(initialSearch = DEFAULT_SEARCH, canManage = true) {
  search = initialSearch;
  render(<ClientsFilterBar canManage={canManage} />);
}

function tabHref(name: string) {
  return screen.getByRole("link", { name }).getAttribute("href") ?? "";
}

function tabCurrent(name: string) {
  return screen.getByRole("link", { name }).getAttribute("aria-current");
}

describe("ClientsFilterBar", () => {
  beforeEach(() => {
    replace.mockClear();
    // The nested BookSwitcher fetches /api/advisors on mount.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ advisors: [] }) }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    search = "";
  });

  it("drops take when the status filter changes", () => {
    renderBar();
    fireEvent.change(screen.getByLabelText("Filter by status"), {
      target: { value: "active" },
    });
    // Asserted BEFORE the reset so it still executes if the reset regresses —
    // proves the handler fired and produced a real URL, which keeps the
    // `not.stringContaining` below from passing vacuously.
    expect(replace).toHaveBeenCalledWith(expect.stringContaining("status=active"), {
      scroll: false,
    });
    expect(replace).toHaveBeenCalledWith(expect.not.stringContaining("take="), { scroll: false });
  });

  it("keeps the active sort when filters change", () => {
    renderBar();
    fireEvent.change(screen.getByLabelText("Filter by status"), {
      target: { value: "active" },
    });
    expect(replace).toHaveBeenCalledWith(expect.stringContaining("sort=name"), { scroll: false });
  });

  it("drops take from every view link but keeps the other filters", () => {
    renderBar("view=all&sort=name&dir=asc&take=500&status=active");
    for (const tab of ["Recently opened", "All", "Shared with me", "Trash"]) {
      const href = tabHref(tab);
      // Instrument check first: a link that dropped every param would satisfy
      // the `take=` assertion for the wrong reason.
      expect(href).toContain("sort=name");
      expect(href).toContain("status=active");
      expect(href).not.toContain("take=");
    }
  });

  it("points Recently opened at the bare path — the default view carries no ?view=", () => {
    renderBar("view=all");
    expect(tabHref("Recently opened")).toBe("/clients");
    expect(tabHref("All")).toContain("view=all");
  });

  it("marks the URL's view as the current tab", () => {
    renderBar("view=deleted");
    expect(tabCurrent("Trash")).toBe("page");
    expect(tabCurrent("All")).toBeNull();
  });

  it("falls back to Recently opened when ?view= is unrecognized", () => {
    renderBar("view=bogus");
    expect(tabCurrent("Recently opened")).toBe("page");
  });

  it("hides Trash from non-admins", () => {
    renderBar(DEFAULT_SEARCH, false);
    expect(screen.queryByRole("link", { name: "Trash" })).toBeNull();
    expect(screen.getByRole("link", { name: "All" })).toBeDefined();
  });

  it("hides the search, status, and book filters on the shared view", () => {
    renderBar("view=shared");
    expect(screen.getByRole("link", { name: "Shared with me" })).toBeDefined();
    expect(screen.queryByLabelText("Search by household or contact name")).toBeNull();
    expect(screen.queryByLabelText("Filter by status")).toBeNull();
    expect(screen.queryByLabelText("Viewing advisor's book")).toBeNull();
  });

  it("shows the search, status, and book filters on the other views", () => {
    renderBar("view=all");
    expect(screen.getByLabelText("Search by household or contact name")).toBeDefined();
    expect(screen.getByLabelText("Filter by status")).toBeDefined();
    expect(screen.getByLabelText("Viewing advisor's book")).toBeDefined();
  });
});

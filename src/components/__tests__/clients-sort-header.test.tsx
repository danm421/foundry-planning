// @vitest-environment jsdom
/**
 * The Name column reads "John & Jane Cooper" but sorts by LAST name, so the
 * semantics have to live in the accessible name — aria-sort carries state
 * only, it has no vocabulary for which field is sorted.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/clients",
  useSearchParams: () => new URLSearchParams("view=all&take=150"),
}));

import { ClientsSortHeader } from "../clients-sort-header";
import type { ClientSortKey, SortDir } from "@/lib/crm/sort";

function renderHeader(
  activeKey: ClientSortKey | null,
  activeDir: SortDir = "asc",
  sortKey: ClientSortKey = "name",
) {
  return render(
    <table>
      <thead>
        <tr>
          <ClientsSortHeader
            sortKey={sortKey}
            label="Name"
            srLabel="Sort by last name"
            activeKey={activeKey}
            activeDir={activeDir}
          />
        </tr>
      </thead>
    </table>,
  );
}

describe("ClientsSortHeader", () => {
  beforeEach(() => replace.mockClear());

  it("exposes the sorted field in the accessible name, not the visible label", () => {
    renderHeader("name");
    expect(screen.getByRole("button", { name: "Sort by last name" })).toBeInTheDocument();
    expect(screen.getByText("Name")).toBeInTheDocument();
  });

  it("reports ascending state on the column header", () => {
    renderHeader("name", "asc");
    expect(screen.getByRole("columnheader")).toHaveAttribute("aria-sort", "ascending");
  });

  it("reports descending state on the column header", () => {
    renderHeader("name", "desc");
    expect(screen.getByRole("columnheader")).toHaveAttribute("aria-sort", "descending");
  });

  it("reports no sort state when another column is active", () => {
    renderHeader("updated");
    expect(screen.getByRole("columnheader")).toHaveAttribute("aria-sort", "none");
  });

  it("applies the key's default direction when it is not the active column", () => {
    renderHeader("updated");
    fireEvent.click(screen.getByRole("button"));
    expect(replace).toHaveBeenCalledWith(
      expect.stringContaining("sort=name"),
      { scroll: false },
    );
    expect(replace).toHaveBeenCalledWith(expect.stringContaining("dir=asc"), { scroll: false });
  });

  it("toggles direction when it is already the active column", () => {
    renderHeader("name", "asc");
    fireEvent.click(screen.getByRole("button"));
    expect(replace).toHaveBeenCalledWith(expect.stringContaining("dir=desc"), { scroll: false });
  });

  it("resets pagination so a new sort does not keep a large take", () => {
    renderHeader("name", "asc");
    fireEvent.click(screen.getByRole("button"));
    expect(replace).toHaveBeenCalledWith(expect.not.stringContaining("take="), { scroll: false });
  });

  it("applies a descending default for a key whose default direction is desc", () => {
    renderHeader("name", "asc", "updated");
    fireEvent.click(screen.getByRole("button"));
    expect(replace).toHaveBeenCalledWith(expect.stringContaining("sort=updated"), { scroll: false });
    expect(replace).toHaveBeenCalledWith(expect.stringContaining("dir=desc"), { scroll: false });
  });

  it("preserves unrelated params", () => {
    renderHeader("name", "asc");
    fireEvent.click(screen.getByRole("button"));
    expect(replace).toHaveBeenCalledWith(expect.stringContaining("view=all"), { scroll: false });
  });
});

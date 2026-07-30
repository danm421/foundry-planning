// @vitest-environment jsdom
/**
 * The book switcher changes the result set, so — like the status filter and
 * the sort headers — it has to drop `?take=`. Without that, an admin who paged
 * to 1000 rows and then switched advisors silently re-fetches 1000 rows of a
 * different book.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const replace = vi.fn();

/**
 * Mutable so each test seeds the URL it needs. Test 2 MUST start from
 * `advisor=adv_2` — its `not.stringContaining("advisor=")` assertion is vacuous
 * otherwise, because there'd be no advisor param to drop in the first place.
 * `afterEach` clears it so a test that forgets to seed can't silently inherit
 * the previous test's URL.
 */
let search = "";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/clients",
  useSearchParams: () => new URLSearchParams(search),
}));

import { BookSwitcher } from "../book-switcher";

const SELECT = "Viewing advisor's book";

/**
 * Renders and waits for the async `/api/advisors` list to land. The advisor
 * `<option>` must exist before `fireEvent.change` — a select silently refuses
 * a value with no matching option, which would make the change a no-op.
 */
async function renderSwitcher(initialSearch: string) {
  search = initialSearch;
  render(<BookSwitcher />);
  await screen.findByRole("option", { name: /Dana/ });
  return screen.getByLabelText(SELECT);
}

describe("BookSwitcher pagination reset", () => {
  beforeEach(() => {
    replace.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ advisors: [{ userId: "adv_2", displayName: "Dana" }] }),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    search = "";
  });

  it("drops take when switching to a specific advisor's book", async () => {
    const select = await renderSwitcher("view=all&sort=name&dir=asc&take=500");

    fireEvent.change(select, { target: { value: "adv_2" } });

    // Asserted BEFORE the reset so it still executes if the reset regresses —
    // proves the handler actually fired and produced a real URL, which is what
    // keeps the `not.stringContaining` below from passing vacuously.
    expect(replace).toHaveBeenCalledWith(expect.stringContaining("advisor=adv_2"), {
      scroll: false,
    });
    expect(replace).toHaveBeenCalledWith(expect.not.stringContaining("take="), { scroll: false });
  });

  it("drops take and advisor when switching back to All clients", async () => {
    const select = await renderSwitcher("view=all&sort=name&dir=asc&take=500&advisor=adv_2");

    fireEvent.change(select, { target: { value: "all" } });

    expect(replace).toHaveBeenCalledWith(expect.stringContaining("view=all"), { scroll: false });
    expect(replace).toHaveBeenCalledWith(expect.not.stringContaining("advisor="), {
      scroll: false,
    });
    expect(replace).toHaveBeenCalledWith(expect.not.stringContaining("take="), { scroll: false });
  });

  it("keeps the active sort when the book changes", async () => {
    const select = await renderSwitcher("view=all&sort=name&dir=asc&take=500");

    fireEvent.change(select, { target: { value: "adv_2" } });

    expect(replace).toHaveBeenCalledWith(expect.stringContaining("sort=name"), { scroll: false });
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/clients",
  useSearchParams: () => new URLSearchParams("view=all&sort=name&dir=asc&take=500"),
}));

import { CrmHouseholdSearch } from "../crm-household-search";

describe("CrmHouseholdSearch pagination reset", () => {
  beforeEach(() => replace.mockClear());

  it("drops take when the status filter changes", () => {
    render(<CrmHouseholdSearch />);
    fireEvent.change(screen.getByLabelText("Filter by status"), {
      target: { value: "active" },
    });
    expect(replace).toHaveBeenCalledWith(expect.not.stringContaining("take="), { scroll: false });
    expect(replace).toHaveBeenCalledWith(expect.stringContaining("status=active"), {
      scroll: false,
    });
  });

  it("drops take when the view toggle changes", () => {
    render(<CrmHouseholdSearch />);
    fireEvent.click(screen.getByRole("button", { name: "Recently opened" }));
    expect(replace).toHaveBeenCalledWith(expect.not.stringContaining("take="), { scroll: false });
  });

  it("keeps the active sort when filters change", () => {
    render(<CrmHouseholdSearch />);
    fireEvent.change(screen.getByLabelText("Filter by status"), {
      target: { value: "active" },
    });
    expect(replace).toHaveBeenCalledWith(expect.stringContaining("sort=name"), { scroll: false });
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/clients",
  useSearchParams: () => new URLSearchParams("view=all&sort=name&dir=asc"),
}));

import { ClientsLoadMore } from "../clients-load-more";

describe("ClientsLoadMore", () => {
  beforeEach(() => replace.mockClear());

  it("raises take by one page", () => {
    render(<ClientsLoadMore take={50} />);
    fireEvent.click(screen.getByRole("button", { name: /load more/i }));
    expect(replace).toHaveBeenCalledWith(expect.stringContaining("take=100"), { scroll: false });
  });

  it("raises take by one page from an already-grown value", () => {
    render(<ClientsLoadMore take={150} />);
    fireEvent.click(screen.getByRole("button", { name: /load more/i }));
    expect(replace).toHaveBeenCalledWith(expect.stringContaining("take=200"), { scroll: false });
  });

  it("keeps the active sort while paging", () => {
    render(<ClientsLoadMore take={50} />);
    fireEvent.click(screen.getByRole("button", { name: /load more/i }));
    expect(replace).toHaveBeenCalledWith(expect.stringContaining("sort=name"), { scroll: false });
  });
});

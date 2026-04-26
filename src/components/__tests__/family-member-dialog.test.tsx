// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/clients/c1/client-data/family",
  useSearchParams: () => new URLSearchParams(),
}));

import FamilyMemberDialog from "@/components/family-member-dialog";

const mockFetch = vi.fn();

beforeEach(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("FamilyMemberDialog", () => {
  it("posts to the create endpoint and calls onSaved with mode='create'", async () => {
    const onSaved = vi.fn();
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "f1", firstName: "Tom", lastName: "Jr", relationship: "child" }),
    });
    render(
      <FamilyMemberDialog
        clientId="c1"
        open
        onOpenChange={() => {}}
        onSaved={onSaved}
      />,
    );
    await user.type(screen.getByLabelText(/first name/i), "Tom");
    await user.type(screen.getByLabelText(/last name/i), "Jr");
    await user.click(screen.getByRole("button", { name: /add/i }));
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/clients/c1/family-members",
      expect.objectContaining({ method: "POST" }),
    );
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({ id: "f1", firstName: "Tom" }),
      "create",
    );
  });

  it("pre-fills fields when editing prop is passed and uses PUT", async () => {
    const onSaved = vi.fn();
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "f1", firstName: "Tom", lastName: "Sr", relationship: "child" }),
    });
    render(
      <FamilyMemberDialog
        clientId="c1"
        open
        onOpenChange={() => {}}
        onSaved={onSaved}
        editing={{
          id: "f1",
          firstName: "Tom",
          lastName: "Jr",
          relationship: "child",
          dateOfBirth: null,
          notes: null,
        } as never}
      />,
    );
    expect(screen.getByDisplayValue("Tom")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Jr")).toBeInTheDocument();
    await user.clear(screen.getByLabelText(/last name/i));
    await user.type(screen.getByLabelText(/last name/i), "Sr");
    await user.click(screen.getByRole("button", { name: /save changes/i }));
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/clients/c1/family-members/f1",
      expect.objectContaining({ method: "PUT" }),
    );
    expect(onSaved).toHaveBeenCalledWith(expect.anything(), "edit");
  });

  it("renders a Delete button when editing + onRequestDelete is passed", () => {
    const onRequestDelete = vi.fn();
    render(
      <FamilyMemberDialog
        clientId="c1"
        open
        onOpenChange={() => {}}
        onSaved={vi.fn()}
        onRequestDelete={onRequestDelete}
        editing={{
          id: "f1",
          firstName: "Tom",
          lastName: "Jr",
          relationship: "child",
          dateOfBirth: null,
          notes: null,
        } as never}
      />,
    );
    expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
  });
});

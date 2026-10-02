// @vitest-environment jsdom
// Inside a scenario the member dialog writes a scenario change, and a save that
// changes nothing must send the very values the row already holds, so the
// writer's "equal to base" check collapses it instead of recording an edit.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/clients/c1/solver",
  useSearchParams: () => new URLSearchParams("scenario=scn-1"),
}));

import FamilyMemberDialog from "@/components/family-member-dialog";

const mockFetch = vi.fn();
beforeEach(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
});

const EDITING = {
  id: "fm-1",
  firstName: "Tom",
  lastName: null,
  relationship: "child",
  role: "child",
  dateOfBirth: "2015-01-01",
  notes: null,
  domesticPartner: false,
  inheritanceClassOverride: {},
  claimedAsDependent: "auto",
} as const;

describe("FamilyMemberDialog inside a scenario", () => {
  it("an unchanged save sends the row's own values, a null last name included", async () => {
    const user = userEvent.setup();
    render(<FamilyMemberDialog clientId="c1" open onOpenChange={() => {}} onSaved={vi.fn()} editing={{ ...EDITING }} />);
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe("/api/clients/c1/scenarios/scn-1/changes");
    const { desiredFields } = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(desiredFields).toEqual({
      firstName: "Tom",
      lastName: null,
      relationship: "child",
      dateOfBirth: "2015-01-01",
      notes: null,
      domesticPartner: false,
      inheritanceClassOverride: {},
    });
  });

  it("an add with no last name sends null, not an empty string", async () => {
    const user = userEvent.setup();
    render(<FamilyMemberDialog clientId="c1" open onOpenChange={() => {}} onSaved={vi.fn()} />);
    await user.type(screen.getByLabelText(/first name/i), "Tom");
    await user.click(screen.getByRole("button", { name: "Add" }));

    const { entity } = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(entity.lastName).toBeNull();
  });

  // The base tree keeps a stored "" last name as "", and the base routes store a
  // blank one that way, so an unchanged save must send "" back, not null.
  it("an unchanged save of a member stored with an empty last name sends \"\"", async () => {
    const user = userEvent.setup();
    render(<FamilyMemberDialog clientId="c1" open onOpenChange={() => {}} onSaved={vi.fn()} editing={{ ...EDITING, lastName: "" } as never} />);
    await user.click(screen.getByRole("button", { name: "Save Changes" }));
    const { desiredFields } = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(desiredFields.lastName).toBe("");
  });

  it("clearing a real last name sends null", async () => {
    const user = userEvent.setup();
    render(<FamilyMemberDialog clientId="c1" open onOpenChange={() => {}} onSaved={vi.fn()} editing={{ ...EDITING, lastName: "Lee" } as never} />);
    await user.clear(screen.getByLabelText(/last name/i));
    await user.click(screen.getByRole("button", { name: "Save Changes" }));
    const { desiredFields } = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(desiredFields.lastName).toBeNull();
  });

  it("an unchanged save of a member with notes sends the row's own notes", async () => {
    const user = userEvent.setup();
    render(<FamilyMemberDialog clientId="c1" open onOpenChange={() => {}} onSaved={vi.fn()} editing={{ ...EDITING, notes: "Allergic" } as never} />);
    await user.click(screen.getByRole("button", { name: "Save Changes" }));
    const { desiredFields } = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(desiredFields.notes).toBe("Allergic");
  });
});

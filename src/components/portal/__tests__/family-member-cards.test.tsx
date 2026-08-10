// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import FamilyMemberCards from "../family-member-cards";

const ROWS = [
  {
    id: "f1",
    firstName: "Kevin",
    lastName: "Sample",
    relationship: "child",
    dateOfBirth: "2008-04-02",
  },
];

function mockFetch(ok = true) {
  const fn = vi.fn().mockResolvedValue({
    ok,
    json: async () => (ok ? { ok: true } : { error: "nope" }),
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => {
  refresh.mockClear();
  vi.unstubAllGlobals();
});

describe("FamilyMemberCards", () => {
  it("renders a card per member with relationship and a timezone-safe DOB", () => {
    render(<FamilyMemberCards rows={ROWS} editEnabled />);

    expect(screen.getByRole("button", { name: "Edit Kevin Sample" })).toBeTruthy();
    expect(screen.getByText("Child")).toBeTruthy();
    // "2008-04-02" parsed as a Date would render 4/1/2008 west of Greenwich.
    expect(screen.getByText("4/2/2008")).toBeTruthy();
  });

  it("offers no controls when portal editing is off", () => {
    render(<FamilyMemberCards rows={ROWS} editEnabled={false} />);

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Kevin Sample")).toBeTruthy();
  });

  it("adds a person through the dialog", async () => {
    const fetchMock = mockFetch();
    const user = userEvent.setup();
    render(<FamilyMemberCards rows={ROWS} editEnabled />);

    await user.click(screen.getByRole("button", { name: "Add person" }));
    await user.type(screen.getByLabelText("First name"), "Timmy");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/portal/family");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toMatchObject({
      firstName: "Timmy",
      relationship: "child",
      dateOfBirth: null,
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("edits an existing member by id", async () => {
    const fetchMock = mockFetch();
    const user = userEvent.setup();
    render(<FamilyMemberCards rows={ROWS} editEnabled />);

    await user.click(screen.getByRole("button", { name: "Edit Kevin Sample" }));
    const first = screen.getByLabelText("First name");
    await user.clear(first);
    await user.type(first, "Kev");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/portal/family/f1");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body).firstName).toBe("Kev");
  });

  it("requires a second press before deleting", async () => {
    const fetchMock = mockFetch();
    const user = userEvent.setup();
    render(<FamilyMemberCards rows={ROWS} editEnabled />);

    await user.click(screen.getByRole("button", { name: "Edit Kevin Sample" }));
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Confirm remove" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/portal/family/f1");
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
  });

  it("keeps the dialog open and shows the server error on a failed save", async () => {
    mockFetch(false);
    const user = userEvent.setup();
    render(<FamilyMemberCards rows={ROWS} editEnabled />);

    await user.click(screen.getByRole("button", { name: "Add person" }));
    await user.type(screen.getByLabelText("First name"), "Timmy");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("nope");
    expect(refresh).not.toHaveBeenCalled();
  });
});

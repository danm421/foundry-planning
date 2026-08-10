// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import HouseholdContactCards from "../household-contact-cards";

const PRIMARY = {
  id: "p1",
  firstName: "Cooper",
  lastName: "Sample",
  email: "cooper@example.com",
  phone: "484-213-4856",
};

const SPOUSE = {
  id: "s1",
  firstName: "Susan",
  lastName: "Sample",
  email: null,
  phone: null,
};

function mockFetch() {
  const fn = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => {
  refresh.mockClear();
  vi.unstubAllGlobals();
});

describe("HouseholdContactCards", () => {
  it("sends only the edited role and only the changed fields", async () => {
    const fetchMock = mockFetch();
    const user = userEvent.setup();
    render(
      <HouseholdContactCards primary={PRIMARY} spouse={SPOUSE} editEnabled />,
    );

    await user.click(screen.getByRole("button", { name: "Edit Susan Sample" }));
    await user.type(screen.getByLabelText("Email"), "susan@example.com");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/portal/household");
    expect(init.method).toBe("PUT");
    // Untouched fields must stay out — the route audits per-field before/after,
    // so a full-object PUT would log every field as changed on every save.
    expect(JSON.parse(init.body)).toEqual({
      spouse: { email: "susan@example.com" },
    });
  });

  it("clears a nullable field as null, never an empty string", async () => {
    const fetchMock = mockFetch();
    const user = userEvent.setup();
    render(
      <HouseholdContactCards primary={PRIMARY} spouse={null} editEnabled />,
    );

    await user.click(screen.getByRole("button", { name: "Edit Cooper Sample" }));
    await user.clear(screen.getByLabelText("Phone"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      primary: { phone: null },
    });
  });

  it("clears last name to an empty string — the column is NOT NULL", async () => {
    const fetchMock = mockFetch();
    const user = userEvent.setup();
    render(
      <HouseholdContactCards primary={PRIMARY} spouse={null} editEnabled />,
    );

    await user.click(screen.getByRole("button", { name: "Edit Cooper Sample" }));
    await user.clear(screen.getByLabelText("Last name"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      primary: { lastName: "" },
    });
  });

  it("keeps Save disabled until something changes", async () => {
    const user = userEvent.setup();
    render(
      <HouseholdContactCards primary={PRIMARY} spouse={null} editEnabled />,
    );

    await user.click(screen.getByRole("button", { name: "Edit Cooper Sample" }));
    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    await user.type(screen.getByLabelText("First name"), "!");
    expect(save.disabled).toBe(false);
  });

  it("refuses to save a blank first name", async () => {
    const fetchMock = mockFetch();
    const user = userEvent.setup();
    render(
      <HouseholdContactCards primary={PRIMARY} spouse={null} editEnabled />,
    );

    await user.click(screen.getByRole("button", { name: "Edit Cooper Sample" }));
    await user.clear(screen.getByLabelText("First name"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "First name is required",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders plain cards with no controls when editing is off", () => {
    render(
      <HouseholdContactCards
        primary={PRIMARY}
        spouse={SPOUSE}
        editEnabled={false}
      />,
    );

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Cooper Sample")).toBeTruthy();
    // No "Add email" nudge for a client who cannot act on it.
    expect(screen.queryByText("Add email")).toBeNull();
  });
});

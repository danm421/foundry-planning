// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ComponentProps } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CrmHouseholdEditForm } from "../crm-household-edit-form";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function renderForm(overrides: Partial<ComponentProps<typeof CrmHouseholdEditForm>> = {}) {
  return render(
    <CrmHouseholdEditForm
      open
      onOpenChange={vi.fn()}
      householdId="h1"
      initialName="John & Jane Smith"
      initialStatus="active"
      initialNotes={null}
      initialNameIsCustom={false}
      derivedName="John & Jane Smith"
      initialState="IL"
      planLinked
      primaryContact={{
        id: "c1",
        addressLine1: "12 Elm St",
        addressLine2: null,
        city: "Springfield",
        state: "IL",
        postalCode: "62701",
      }}
      {...overrides}
    />,
  );
}

describe("CrmHouseholdEditForm name lock", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the name read-only when unlocked", () => {
    renderForm();
    expect(screen.getByLabelText(/household name/i)).toHaveAttribute("readonly");
  });

  it("makes the name editable once the box is ticked", () => {
    renderForm();
    fireEvent.click(screen.getByLabelText(/use a custom name/i));
    expect(screen.getByLabelText(/household name/i)).not.toHaveAttribute("readonly");
  });

  it("restores the derived name when the box is unticked", () => {
    renderForm({ initialName: "Smith Family Trust", initialNameIsCustom: true });
    const input = screen.getByLabelText(/household name/i) as HTMLInputElement;
    expect(input.value).toBe("Smith Family Trust");

    fireEvent.click(screen.getByLabelText(/use a custom name/i));
    expect(input.value).toBe("John & Jane Smith");
  });

  it("forces custom mode when there is no derivable name", () => {
    renderForm({ derivedName: null, initialNameIsCustom: true });
    const box = screen.getByLabelText(/use a custom name/i) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(box.disabled).toBe(true);
    expect(screen.getByLabelText(/household name/i)).not.toHaveAttribute("readonly");
  });
});

describe("CrmHouseholdEditForm state and address", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  const save = () => fireEvent.submit(document.getElementById("crm-household-edit-form")!);
  const sent = () =>
    fetchMock.mock.calls.map(([url, init]) => ({ url, body: JSON.parse(init.body) }));

  it("leaves the state and the address alone when neither changed", async () => {
    renderForm();
    save();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sent()[0].url).toBe("/api/crm/households/h1");
    expect(sent()[0].body).not.toHaveProperty("state");
  });

  it("sends a changed state of residence with the household", async () => {
    renderForm();
    fireEvent.change(screen.getByRole("combobox", { name: /state of residence/i }), { target: { value: "FL" } });
    save();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sent()[0].body.state).toBe("FL");
  });

  it("patches only the changed address fields onto the primary contact", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/^street$/i), { target: { value: "40 Oak Ave" } });
    fireEvent.change(screen.getByLabelText(/apt, suite, unit/i), { target: { value: "Unit 3" } });
    save();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(sent()[1]).toEqual({
      url: "/api/crm/households/h1/contacts/c1",
      body: { addressLine1: "40 Oak Ave", addressLine2: "Unit 3" },
    });
  });

  it("has no address fields when there is no primary contact", () => {
    renderForm({ primaryContact: null });
    expect(screen.queryByLabelText(/^street$/i)).toBeNull();
  });
});

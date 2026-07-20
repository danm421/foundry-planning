// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ComponentProps } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
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

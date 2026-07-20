// @vitest-environment jsdom
import { it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CrmHouseholdForm } from "../crm-household-form";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({ user: { id: "user_1" }, isLoaded: true }),
}));

it("keeps the name in sync with the contacts until the box is ticked", () => {
  render(<CrmHouseholdForm mode="create" />);
  fireEvent.change(screen.getByLabelText(/^first name$/i), { target: { value: "John" } });
  fireEvent.change(screen.getByLabelText(/^last name$/i), { target: { value: "Smith" } });

  const nameInput = screen.getByLabelText(/household name/i) as HTMLInputElement;
  expect(nameInput.value).toBe("John Smith");
  expect(nameInput).toHaveAttribute("readonly");

  fireEvent.click(screen.getByLabelText(/use a custom name/i));
  expect(nameInput).not.toHaveAttribute("readonly");

  fireEvent.change(nameInput, { target: { value: "Smith Family Trust" } });
  fireEvent.change(screen.getByLabelText(/^first name$/i), { target: { value: "Jonathan" } });
  // Locked: the contact edit must not rewrite it.
  expect(nameInput.value).toBe("Smith Family Trust");
});

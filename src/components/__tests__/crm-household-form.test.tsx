// @vitest-environment jsdom
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CrmHouseholdForm } from "../crm-household-form";

const pushMock = vi.fn();
const replaceMock = vi.fn();
let mockSearch = "";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
  useSearchParams: () => new URLSearchParams(mockSearch),
}));
vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({ user: { id: "user_1" }, isLoaded: true }),
}));

beforeEach(() => {
  pushMock.mockReset();
  replaceMock.mockReset();
  mockSearch = "";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Fills the required fields and submits, with the create POST stubbed. */
function submitCreate(container: HTMLElement) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ household: { id: "hh-1", name: "John Smith" } }),
    }),
  );
  fireEvent.change(screen.getByLabelText(/^first name$/i), { target: { value: "John" } });
  fireEvent.change(screen.getByLabelText(/^last name$/i), { target: { value: "Smith" } });
  fireEvent.change(screen.getByLabelText(/state of residence/i), { target: { value: "CA" } });
  fireEvent.submit(container.querySelector("form")!);
}

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

it("restores the derived name and resumes syncing when the box is unticked", () => {
  render(<CrmHouseholdForm mode="create" />);
  fireEvent.change(screen.getByLabelText(/^first name$/i), { target: { value: "John" } });
  fireEvent.change(screen.getByLabelText(/^last name$/i), { target: { value: "Smith" } });

  const nameInput = screen.getByLabelText(/household name/i) as HTMLInputElement;
  fireEvent.click(screen.getByLabelText(/use a custom name/i));
  fireEvent.change(nameInput, { target: { value: "Smith Family Trust" } });
  expect(nameInput.value).toBe("Smith Family Trust");

  // Untick: the custom value must snap back to the derived name immediately.
  fireEvent.click(screen.getByLabelText(/use a custom name/i));
  expect(nameInput.value).toBe("John Smith");
  expect(nameInput).toHaveAttribute("readonly");

  // Syncing must resume: a subsequent contact edit updates the name again.
  fireEvent.change(screen.getByLabelText(/^first name$/i), { target: { value: "Jonathan" } });
  expect(nameInput.value).toBe("Jonathan Smith");
});

it("offers the planning start paths instead of navigating when there is no returnTo", async () => {
  const { container } = render(<CrmHouseholdForm mode="create" />);
  submitCreate(container);

  const dialog = await screen.findByRole("dialog", { name: /household created/i });
  expect(dialog).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /guided/i })).toBeInTheDocument();
  // Stayed put: the advisor is still on /crm/new, under the prompt.
  expect(pushMock).not.toHaveBeenCalled();
  expect(replaceMock).not.toHaveBeenCalled();
  // And the form behind it can't be fired again into a duplicate household.
  expect(screen.getByRole("button", { name: /creating/i })).toBeDisabled();
});

it("bounces back without prompting when returnTo is set", async () => {
  mockSearch = "returnTo=%2Fclients%2Fnew";
  const { container } = render(<CrmHouseholdForm mode="create" />);
  submitCreate(container);

  await waitFor(() =>
    expect(pushMock).toHaveBeenCalledWith("/clients/new?crmHouseholdId=hh-1"),
  );
  expect(screen.queryByRole("dialog", { name: /household created/i })).toBeNull();
});

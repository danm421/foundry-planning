// @vitest-environment jsdom
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import QuickCreateForm from "../quick-create-form";

let mockSearch = "";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(mockSearch),
}));
vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({ user: { id: "user_1" }, isLoaded: true }),
}));

type Role = "primary" | "spouse";

function stubHousehold(roles: Role[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        household: {
          id: "hh-1",
          name: "Cooper Sample",
          contacts: roles.map((role) => ({
            role,
            firstName: role === "primary" ? "Cooper" : "Susan",
            lastName: "Sample",
          })),
        },
      }),
    }),
  );
}

beforeEach(() => {
  mockSearch = "";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("pre-selects the card named by ?path=", async () => {
  mockSearch = "crmHouseholdId=hh-1&path=import";
  stubHousehold(["primary"]);
  render(<QuickCreateForm />);

  await waitFor(() =>
    expect(screen.getByRole("button", { name: /ai import/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    ),
  );
  expect(screen.getByRole("button", { name: /quick start/i })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

it("selects nothing when ?path= is unrecognized", async () => {
  mockSearch = "crmHouseholdId=hh-1&path=bogus";
  stubHousehold(["primary"]);
  render(<QuickCreateForm />);

  await waitFor(() => expect(screen.getByRole("button", { name: /ai import/i })).toBeInTheDocument());
  for (const name of [/quick start/i, /detailed setup/i, /ai import/i, /empty client/i]) {
    expect(screen.getByRole("button", { name })).toHaveAttribute("aria-pressed", "false");
  }
});

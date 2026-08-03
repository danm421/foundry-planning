// @vitest-environment jsdom
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
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

function householdPayload(id: string, roles: Role[]) {
  return {
    household: {
      id,
      name: "Cooper Sample",
      contacts: roles.map((role) => ({
        role,
        firstName: role === "primary" ? "Cooper" : "Susan",
        lastName: "Sample",
      })),
    },
  };
}

// Dispatches on the requested URL so different `crmHouseholdId`s can return
// different fixtures (needed to test re-derivation on a household switch).
function stubHouseholds(byId: Record<string, Role[]>) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const id = Object.keys(byId).find((hhId) => url.includes(`/households/${hhId}`));
      if (!id) {
        return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
      }
      return Promise.resolve({ ok: true, json: async () => householdPayload(id, byId[id]) });
    }),
  );
}

function stubHousehold(roles: Role[]) {
  stubHouseholds({ "hh-1": roles });
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
  expect(screen.getByRole("button", { name: /guided/i })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

it("selects nothing when ?path= is unrecognized", async () => {
  mockSearch = "crmHouseholdId=hh-1&path=bogus";
  stubHousehold(["primary"]);
  render(<QuickCreateForm />);

  await waitFor(() => expect(screen.getByRole("button", { name: /ai import/i })).toBeInTheDocument());
  for (const name of [/guided/i, /ai import/i, /empty client/i]) {
    expect(screen.getByRole("button", { name })).toHaveAttribute("aria-pressed", "false");
  }
});

it("does not render the step-2 detail form for an unrecognized ?path=", async () => {
  // An unrecognized value must leave `path` at null, which gates the whole
  // detail form off (`{path && (<form>...`). A naive cast (`queryPath as
  // StartPath | null` with no validation) would instead leave `path` set to
  // the raw string "bogus" — truthy, so the form (and its "Create client"
  // submit button, the default label for any non-guided/import path)
  // would incorrectly render. This is the only assertion in this suite that
  // can tell `isStartPath` narrowing apart from an unvalidated cast.
  mockSearch = "crmHouseholdId=hh-1&path=bogus";
  stubHousehold(["primary"]);
  render(<QuickCreateForm />);

  await waitFor(() => expect(screen.getByRole("button", { name: /ai import/i })).toBeInTheDocument());
  expect(screen.queryByRole("button", { name: /create client/i })).not.toBeInTheDocument();
});

it("selects nothing when ?path= is absent", async () => {
  mockSearch = "crmHouseholdId=hh-1";
  stubHousehold(["primary"]);
  render(<QuickCreateForm />);

  await waitFor(() => expect(screen.getByRole("button", { name: /ai import/i })).toBeInTheDocument());
  for (const name of [/guided/i, /ai import/i, /empty client/i]) {
    expect(screen.getByRole("button", { name })).toHaveAttribute("aria-pressed", "false");
  }
});

it("defaults filing status to married_joint when the household has a spouse", async () => {
  mockSearch = "crmHouseholdId=hh-1&path=guided";
  stubHousehold(["primary", "spouse"]);
  render(<QuickCreateForm />);

  await waitFor(() =>
    expect((screen.getByLabelText(/filing status/i) as HTMLSelectElement).value).toBe(
      "married_joint",
    ),
  );
});

it("defaults filing status to single when the household has no spouse", async () => {
  // Start on a spouse household so `filingStatus` first derives away from
  // its "single" initial state. Asserting "single" straight off a no-spouse
  // mount can't tell "the derivation ran and produced single" apart from
  // "the derivation never ran and the initial state leaked through" — both
  // look identical for a no-spouse fixture, no matter how long the
  // assertion waits. Switching households first forces the value away from
  // "single", so re-deriving back down to "single" on the no-spouse switch
  // is only possible if the derivation genuinely ran.
  mockSearch = "crmHouseholdId=hh-1&path=guided";
  stubHouseholds({ "hh-1": ["primary", "spouse"], "hh-2": ["primary"] });
  const { rerender } = render(<QuickCreateForm />);

  await waitFor(() =>
    expect((screen.getByLabelText(/filing status/i) as HTMLSelectElement).value).toBe(
      "married_joint",
    ),
  );

  mockSearch = "crmHouseholdId=hh-2&path=guided";
  rerender(<QuickCreateForm />);

  await waitFor(() =>
    expect((screen.getByLabelText(/filing status/i) as HTMLSelectElement).value).toBe("single"),
  );
});

it("keeps an advisor's manual filing-status override across an unrelated re-render", async () => {
  mockSearch = "crmHouseholdId=hh-1&path=guided";
  stubHousehold(["primary", "spouse"]);
  render(<QuickCreateForm />);

  await waitFor(() =>
    expect((screen.getByLabelText(/filing status/i) as HTMLSelectElement).value).toBe(
      "married_joint",
    ),
  );

  fireEvent.change(screen.getByLabelText(/filing status/i), {
    target: { value: "head_of_household" },
  });
  expect((screen.getByLabelText(/filing status/i) as HTMLSelectElement).value).toBe(
    "head_of_household",
  );

  // Toggling the spouse-fields checkbox re-renders the form without
  // touching `householdId`, so the preview effect (keyed on `[householdId]`)
  // must not re-fire and stomp the advisor's override.
  fireEvent.click(screen.getByRole("checkbox", { name: /add spouse planning fields/i }));

  // Give any (incorrectly) re-triggered household refetch a real chance to
  // resolve and land its state update before we assert. Without this flush,
  // a stray re-fetch racing the assertion could still be in flight and the
  // test would pass by accident regardless of whether the dependency array
  // is correct — asserting immediately proved nothing either way.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  expect((screen.getByLabelText(/filing status/i) as HTMLSelectElement).value).toBe(
    "head_of_household",
  );
});

it("re-derives filing status when the advisor switches to a different household", async () => {
  mockSearch = "crmHouseholdId=hh-1&path=guided";
  stubHouseholds({ "hh-1": ["primary"], "hh-2": ["primary", "spouse"] });
  const { rerender } = render(<QuickCreateForm />);

  await waitFor(() =>
    expect((screen.getByLabelText(/filing status/i) as HTMLSelectElement).value).toBe("single"),
  );

  mockSearch = "crmHouseholdId=hh-2&path=guided";
  rerender(<QuickCreateForm />);

  await waitFor(() =>
    expect((screen.getByLabelText(/filing status/i) as HTMLSelectElement).value).toBe(
      "married_joint",
    ),
  );
});

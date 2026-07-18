// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

// ContactsTab is a client component that calls useRouter() for router.refresh()
// after a save/delete. There's no app-router context under vitest, so stub it.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { ContactsTab } from "../contacts-tab";

const household = {
  id: "hh1",
  contacts: [
    { id: "p1", role: "primary", firstName: "Dan", lastName: "Cooper", familyMemberId: null,
      relationshipLabel: null, preferredName: null, dateOfBirth: null, email: null, phone: null,
      mobile: null, addressLine1: null, addressLine2: null, city: null, state: null,
      postalCode: null, country: null, ssnLast4: null, notes: null },
    { id: "o1", role: "other", firstName: "Carl", lastName: "Paulson", familyMemberId: null,
      relationshipLabel: "CPA", preferredName: null, dateOfBirth: null, email: null, phone: null,
      mobile: null, addressLine1: null, addressLine2: null, city: null, state: null,
      postalCode: null, country: null, ssnLast4: null, notes: null },
  ],
  planningClient: {
    id: "cl1",
    familyMembers: [
      { id: "fm1", firstName: "Emma", lastName: "Cooper", relationship: "child",
        dateOfBirth: "2015-04-02", role: "child" },
    ],
  },
} as never;

describe("ContactsTab sections", () => {
  it("renders planning family members and labeled external contacts", () => {
    render(<ContactsTab household={household} />);
    expect(screen.getByText("Emma Cooper")).toBeInTheDocument();
    expect(screen.getByText("Child")).toBeInTheDocument();
    expect(screen.getByText("Carl Paulson")).toBeInTheDocument();
    expect(screen.getByText("CPA")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add family member/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add external contact/i })).toBeInTheDocument();
  });
});

// Two family members so the dialog can be reopened for a *different* record.
const twoKids = {
  id: "hh1",
  contacts: [],
  planningClient: {
    id: "cl1",
    familyMembers: [
      { id: "fm1", firstName: "Emma", lastName: "Cooper", relationship: "child",
        dateOfBirth: "2015-04-02", role: "child" },
      { id: "fm2", firstName: "Liam", lastName: "Cooper", relationship: "child",
        dateOfBirth: "2018-09-11", role: "child" },
    ],
  },
} as never;

function editCard(name: string) {
  const card = screen.getByText(name).closest("li");
  if (!card) throw new Error(`No card for ${name}`);
  fireEvent.click(within(card as HTMLElement).getByRole("button", { name: "Edit" }));
}

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

describe("ContactsTab dialog reuse", () => {
  // Guards the two invariants the family form can't guard itself: it keeps a
  // `createdMemberIdRef` across failed submits and clears its `error` only by
  // being unmounted, while DialogShell keeps the form component mounted. The
  // tab must therefore give each open a fresh mount.
  it("does not carry a failed save's error banner into the next record", async () => {
    render(<ContactsTab household={twoKids} />);

    editCard("Emma Cooper");
    expect(screen.getByRole("dialog", { name: "Edit family member" })).toBeInTheDocument();
    expect((screen.getByLabelText(/first name/i) as HTMLInputElement).value).toBe("Emma");

    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Boom" }), { status: 500 }),
    ) as typeof fetch;
    fireEvent.submit(document.getElementById("crm-family-member-form") as HTMLFormElement);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Boom"));

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    editCard("Liam Cooper");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect((screen.getByLabelText(/first name/i) as HTMLInputElement).value).toBe("Liam");
  });
});

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
  // Edit buttons carry aria-label={`Edit ${name}`} (Fix 3) so two columns of
  // cards don't all read as an undifferentiated "Edit" to a screen reader.
  fireEvent.click(within(card as HTMLElement).getByRole("button", { name: `Edit ${name}` }));
}

function deleteCard(name: string) {
  const card = screen.getByText(name).closest("li");
  if (!card) throw new Error(`No card for ${name}`);
  fireEvent.click(within(card as HTMLElement).getByRole("button", { name: `Delete ${name}` }));
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

// A household WITH a planning client, but the dependent contact row is
// unlinked (familyMemberId: null) — deriveContactSections puts it in
// unlinkedFamily, not family. Editing it must still force the family form's
// contact-only branch (see contacts-tab.tsx openUnlinkedEdit / :270-290);
// otherwise a save here would POST an orphan family_members row into planning
// while leaving this contact unlinked.
const householdWithUnlinkedDependent = {
  id: "hh1",
  contacts: [
    { id: "d1", role: "dependent", firstName: "Alex", lastName: "Doe", familyMemberId: null,
      relationshipLabel: null, preferredName: null, dateOfBirth: null, email: null, phone: null,
      mobile: null, addressLine1: null, addressLine2: null, city: null, state: null,
      postalCode: null, country: null, ssnLast4: null, notes: null },
  ],
  planningClient: {
    id: "cl1",
    familyMembers: [],
  },
} as never;

describe("ContactsTab unlinked-dependent edit", () => {
  // Regression guard for Fix 1: proves the unlinked-dependent edit path takes
  // CrmFamilyMemberForm's contact-only branch (planningClientId === null)
  // even though this household HAS a planning client. Probe matches what
  // crm-family-member-form.tsx actually renders when `showRelationship` is
  // false: the "Not linked to planning" copy appears and the Relationship
  // select does not.
  it("stays contact-only when editing an unlinked dependent in a household with a planning client", () => {
    render(<ContactsTab household={householdWithUnlinkedDependent} />);

    editCard("Alex Doe");

    expect(screen.getByRole("dialog", { name: "Edit family member" })).toBeInTheDocument();
    expect(
      screen.getByText("Not linked to planning — contact info only"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/relationship/i)).not.toBeInTheDocument();
  });
});

// Fixture with both a linked family member and an external contact, to
// exercise Fix 2's two delete routes against the same household.
const householdForDeletes = {
  id: "hh1",
  contacts: [
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

describe("ContactsTab delete routing", () => {
  // Guards the two delete flows in contacts-tab.tsx:332-358. A mis-route on
  // the linked-family branch is severe: it would destroy the wrong resource
  // or silently no-op against planning data.
  it("deletes a linked family member via the planning family-members endpoint", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 })) as typeof fetch;

    render(<ContactsTab household={householdForDeletes} />);
    deleteCard("Emma Cooper");

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/clients/cl1/family-members/fm1", {
        method: "DELETE",
      }),
    );

    confirmSpy.mockRestore();
  });

  it("deletes an external contact via the CRM contacts endpoint", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 })) as typeof fetch;

    render(<ContactsTab household={householdForDeletes} />);
    deleteCard("Carl Paulson");

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/crm/households/hh1/contacts/o1", {
        method: "DELETE",
      }),
    );

    confirmSpy.mockRestore();
  });
});

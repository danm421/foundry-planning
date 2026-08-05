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
    render(<ContactsTab household={household} relationships={[]} />);
    expect(screen.getByText("Emma Cooper")).toBeInTheDocument();
    expect(screen.getByText("Child")).toBeInTheDocument();
    expect(screen.getByText("Carl Paulson")).toBeInTheDocument();
    expect(screen.getByText("CPA")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add family member/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add external contact/i })).toBeInTheDocument();
  });
});

// The default state of every newly created household: a primary and a spouse,
// no children, no planning client yet. Both cards render inside the Family
// section, so the heading count and the empty state must agree with them.
const primaryAndSpouseOnly = {
  id: "hh1",
  contacts: [
    { id: "p1", role: "primary", firstName: "Dan", lastName: "Cooper", familyMemberId: null,
      relationshipLabel: null, preferredName: null, dateOfBirth: null, email: null, phone: null,
      mobile: null, addressLine1: null, addressLine2: null, city: null, state: null,
      postalCode: null, country: null, ssnLast4: null, notes: null },
    { id: "s1", role: "spouse", firstName: "Kim", lastName: "Cooper", familyMemberId: null,
      relationshipLabel: null, preferredName: null, dateOfBirth: null, email: null, phone: null,
      mobile: null, addressLine1: null, addressLine2: null, city: null, state: null,
      postalCode: null, country: null, ssnLast4: null, notes: null },
  ],
  planningClient: null,
} as never;

describe("ContactsTab family count", () => {
  // Regression guard: familyCount omitted sections.primarySpouse while those
  // cards render inside the same <section>, so this household read
  // "Family (0)" above two visible cards with "No family members yet"
  // underneath — a self-contradicting screen on the most common household.
  it("counts primary and spouse and suppresses the empty state", () => {
    render(<ContactsTab household={primaryAndSpouseOnly} relationships={[]} />);

    expect(screen.getByRole("heading", { name: "Family (2)" })).toBeInTheDocument();
    expect(screen.getByText("Dan Cooper")).toBeInTheDocument();
    expect(screen.getByText("Kim Cooper")).toBeInTheDocument();
    expect(screen.queryByText(/No family members yet/i)).not.toBeInTheDocument();
  });

  it("still shows the empty state when the section is genuinely empty", () => {
    render(
      <ContactsTab
        household={{ id: "hh1", contacts: [], planningClient: null } as never}
        relationships={[]}
      />,
    );

    expect(screen.getByRole("heading", { name: "Family (0)" })).toBeInTheDocument();
    expect(screen.getByText(/No family members yet/i)).toBeInTheDocument();
  });
});

function cardFor(name: string): HTMLElement {
  const card = screen.getByText(name).closest("li");
  if (!card) throw new Error(`No card for ${name}`);
  return card as HTMLElement;
}

// Same two roles as primaryAndSpouseOnly, but with contact details on file.
const withContactDetails = {
  id: "hh1",
  contacts: [
    { id: "p1", role: "primary", firstName: "Dan", lastName: "Cooper", familyMemberId: null,
      relationshipLabel: null, preferredName: null, dateOfBirth: null,
      email: "dan@example.com", phone: "(555) 010-1234", mobile: "555-010-9999",
      addressLine1: null, addressLine2: null, city: null, state: null,
      postalCode: null, country: null, ssnLast4: null, notes: null },
    // Same number in both slots — must not render twice.
    { id: "s1", role: "spouse", firstName: "Kim", lastName: "Cooper", familyMemberId: null,
      relationshipLabel: null, preferredName: null, dateOfBirth: null,
      email: null, phone: "555-010-2222", mobile: "555-010-2222",
      addressLine1: null, addressLine2: null, city: null, state: null,
      postalCode: null, country: null, ssnLast4: null, notes: null },
  ],
  planningClient: null,
} as never;

describe("ContactsTab client contact details", () => {
  it("renders email and phone as mailto/tel links on the client card", () => {
    render(<ContactsTab household={withContactDetails} relationships={[]} />);
    const card = cardFor("Dan Cooper");

    expect(within(card).getByRole("link", { name: "dan@example.com" })).toHaveAttribute(
      "href",
      "mailto:dan@example.com",
    );
    // Punctuation is stripped from the dial string but kept in the label.
    expect(within(card).getByRole("link", { name: "(555) 010-1234" })).toHaveAttribute(
      "href",
      "tel:5550101234",
    );
    expect(within(card).getByRole("link", { name: "555-010-9999" })).toHaveAttribute(
      "href",
      "tel:5550109999",
    );
  });

  it("renders a phone held in both slots once", () => {
    render(<ContactsTab household={withContactDetails} relationships={[]} />);

    expect(
      within(cardFor("Kim Cooper")).getAllByRole("link", { name: "555-010-2222" }),
    ).toHaveLength(1);
  });

  // The point of the change: an advisor should read email and phone off the
  // card, never by opening Edit. rowsOf drops empty values, so before this the
  // labels vanished entirely on a household with no details captured — which
  // is every household created through the New household form, since that form
  // doesn't collect either field.
  it("keeps the Email and Phone rows on client cards when nothing is on file", () => {
    render(<ContactsTab household={primaryAndSpouseOnly} relationships={[]} />);
    const card = cardFor("Dan Cooper");

    expect(within(card).getByText("Email")).toBeInTheDocument();
    expect(within(card).getByText("Phone")).toBeInTheDocument();
    expect(within(card).queryAllByRole("link")).toHaveLength(0);
  });

  // The placeholder is scoped to primary/spouse. External contacts and family
  // members keep hiding empty rows, so a household of kids doesn't turn into a
  // wall of em-dashes.
  it("still hides empty contact rows on external contact cards", () => {
    render(<ContactsTab household={household} relationships={[]} />);
    const card = cardFor("Carl Paulson");

    expect(within(card).queryByText("Email")).not.toBeInTheDocument();
    expect(within(card).queryByText("Phone")).not.toBeInTheDocument();
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
    render(<ContactsTab household={twoKids} relationships={[]} />);

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
    render(<ContactsTab household={householdWithUnlinkedDependent} relationships={[]} />);

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

    render(<ContactsTab household={householdForDeletes} relationships={[]} />);
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

    render(<ContactsTab household={householdForDeletes} relationships={[]} />);
    deleteCard("Carl Paulson");

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/crm/households/hh1/contacts/o1", {
        method: "DELETE",
      }),
    );

    confirmSpy.mockRestore();
  });
});

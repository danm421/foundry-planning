// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CrmHouseholdRelationshipsSection } from "../crm-household-relationships-section";

// The section calls useRouter().refresh() after link/unlink mutations (same
// pattern as the other CRM tab components) — outside a mounted Next app
// router, useRouter() throws even when refresh() is never called, so every
// RTL test in this repo that renders a useRouter-calling component mocks it.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const relationships = [
  {
    id: "r1", type: "child" as const, viewerSide: "to" as const, label: "Child",
    note: null, sourceFamilyMemberId: "fm1",
    counterpart: { id: "hh2", name: "Sarah Cooper", status: "prospect" },
  },
  {
    id: "r2", type: "business_partner" as const, viewerSide: "from" as const, label: "Business partner",
    note: "Co-owns the bakery", sourceFamilyMemberId: null,
    counterpart: { id: "hh3", name: "Baker Household", status: "active" },
  },
];

describe("CrmHouseholdRelationshipsSection", () => {
  it("renders one card per relationship with perspective label, name, and note", () => {
    render(<CrmHouseholdRelationshipsSection householdId="hh1" relationships={relationships} />);
    expect(screen.getByText("Sarah Cooper")).toBeInTheDocument();
    expect(screen.getByText("Child")).toBeInTheDocument();
    expect(screen.getByText("Baker Household")).toBeInTheDocument();
    expect(screen.getByText("Business partner")).toBeInTheDocument();
    expect(screen.getByText("Co-owns the bakery")).toBeInTheDocument();
  });

  it("links each card to the counterpart household page", () => {
    render(<CrmHouseholdRelationshipsSection householdId="hh1" relationships={relationships} />);
    const link = screen.getByRole("link", { name: /Sarah Cooper/ });
    expect(link).toHaveAttribute("href", "/crm/households/hh2");
  });

  it("shows the empty state when there are no relationships", () => {
    render(<CrmHouseholdRelationshipsSection householdId="hh1" relationships={[]} />);
    expect(screen.getByText(/No related households yet/)).toBeInTheDocument();
  });
});

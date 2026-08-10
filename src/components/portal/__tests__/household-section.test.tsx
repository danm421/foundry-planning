// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Drizzle's query builder is chainable AND awaitable. The clients query
// uses `.where(...).limit(1)` (awaited as array). The crmHouseholdContacts
// query uses `.where(...)` directly (also awaited as array). Mock `.where()`
// to return a thenable that also exposes `.limit()` — so both shapes work.
//
// `await` resolves the thenable to `contactsRows`; `.limit()` returns a
// fresh promise of `[clientRow]`. The section calls clients first
// (with `.limit`), then contacts (raw await) — both reach the right shape.
function mkQuery(): unknown {
  const contactsRows = [
    {
      id: "p1",
      firstName: "Pat",
      lastName: "Client",
      email: "pat@example.com",
      phone: "555-0100",
      role: "primary",
    },
    {
      id: "s1",
      firstName: "Sam",
      lastName: "Client",
      email: null,
      phone: null,
      role: "spouse",
    },
  ];
  const clientRow = {
    crmHouseholdId: "h1",
    filingStatus: "married_joint",
    lifeExpectancy: 92,
    portalEditEnabled: true,
  };
  const thenable = {
    then: (resolve: (v: unknown) => unknown) => resolve(contactsRows),
    limit: () => Promise.resolve([clientRow]),
  };
  return thenable;
}

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => mkQuery(),
      }),
    }),
  },
}));
// The section reaches the DB through `loadPortalHousehold`, whose module also
// imports the family/trusts tables and `and` — stub the whole surface it pulls
// in, not just what the household query touches.
vi.mock("@/db/schema", () => ({
  clients: {},
  crmHouseholdContacts: {},
  entities: {},
  familyMembers: {},
}));
vi.mock("drizzle-orm", () => ({ eq: vi.fn(), and: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import HouseholdSection from "../household-section";

describe("HouseholdSection", () => {
  it("renders a card per contact, each opening the editor", async () => {
    const ui = await HouseholdSection({ clientId: "c1" });
    render(ui);

    expect(screen.getByRole("button", { name: "Edit Pat Client" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit Sam Client" })).toBeTruthy();
    expect(screen.getByText("pat@example.com")).toBeTruthy();
    expect(screen.getByText("Married filing jointly")).toBeTruthy();
  });

  it("prompts for the details a contact is missing", async () => {
    const ui = await HouseholdSection({ clientId: "c1" });
    render(ui);

    // Sam has neither on file; Pat has both, so exactly one of each shows.
    expect(screen.getAllByText("Add email")).toHaveLength(1);
    expect(screen.getAllByText("Add phone")).toHaveLength(1);
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

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
  ];
  const clientRow = {
    crmHouseholdId: "h1",
    filingStatus: "mfj",
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
vi.mock("@/db/schema", () => ({
  clients: {},
  crmHouseholdContacts: {},
}));
vi.mock("drizzle-orm", () => ({ eq: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import HouseholdSection from "../household-section";

describe("HouseholdSection", () => {
  it("renders editable inputs when portalEditEnabled is true", async () => {
    const ui = await HouseholdSection({ clientId: "c1" });
    const { container } = render(ui);
    expect(container.querySelectorAll("input[type='text']").length).toBeGreaterThan(0);
  });
});

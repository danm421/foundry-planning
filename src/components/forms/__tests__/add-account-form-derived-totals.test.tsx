// @vitest-environment jsdom
//
// A holdings-driven account's Current Value and Cost basis are sums of the
// holdings. Summed in floating point they printed as "7,315,553.669999999";
// they now always read to the cent, like every stored account amount.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

import AddAccountForm, { type AccountFormInitial } from "../add-account-form";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/clients/client-123/details",
}));

const BROKERAGE: AccountFormInitial = {
  id: "acct-1",
  name: "Brokerage",
  category: "taxable",
  subType: "brokerage",
  owner: "client",
  value: "0",
  basis: "0",
  growthRate: "0.05",
  owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
};

function holding(id: string, marketValue: string, costBasis: string) {
  return {
    id, accountId: "acct-1", securityId: null, displayTicker: null, displayName: id,
    shares: "0", price: "0", priceAsOf: null, costBasis, marketValue,
    sortOrder: 0, notes: null, securityWeights: [], overrides: [], needsReview: false,
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (String(url).includes("/holdings")) {
      // Σ value 7,315,553.60 and Σ basis 648,030.04 — both carry float noise.
      return {
        ok: true,
        json: async () => [
          holding("h1", "7315553.50", "648029.94"),
          holding("h2", "0.10", "0.10"),
        ],
      };
    }
    return { ok: true, json: async () => [] };
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Account dialog → holdings-derived value and basis", () => {
  it("shows both to exactly two decimal places", async () => {
    render(
      <AddAccountForm
        clientId="client-123"
        category="taxable"
        mode="edit"
        initial={BROKERAGE}
        familyMembers={[{ id: "fm-client", role: "client", firstName: "Alice" }]}
        entities={[]}
        assetClasses={[{ id: "ac-eq", name: "US Equity", slug: "us-equity", geometricReturn: 0.07 }]}
      />,
    );

    expect(await screen.findByDisplayValue("7,315,553.60")).toBeDisabled();
    expect(screen.getByDisplayValue("648,030.04")).toBeDisabled();
  });
});

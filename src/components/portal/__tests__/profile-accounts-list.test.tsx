// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import ProfileAccountsList from "../profile-accounts-list";

const BASE_ROW = {
  accountNumberLast4: null,
  owners: [],
};

const rows = [
  { ...BASE_ROW, id: "1", name: "My Annuity Account", category: "annuity", subType: "other", value: "50000" },
  { ...BASE_ROW, id: "2", name: "My Stock Options", category: "stock_options", subType: "other", value: "25000" },
  { ...BASE_ROW, id: "3", name: "Mystery Future Account", category: "mystery_future_cat", subType: "other", value: "10000" },
];

describe("ProfileAccountsList", () => {
  it("renders annuity and stock_options accounts and their category headings", () => {
    const { container } = render(
      <ProfileAccountsList
        editEnabled={false}
        familyMembers={[]}
        trustEntities={[]}
        rows={rows}
      />,
    );

    // All three account names must appear — none silently dropped
    expect(container.textContent).toContain("My Annuity Account");
    expect(container.textContent).toContain("My Stock Options");
    expect(container.textContent).toContain("Mystery Future Account");

    // Category headings for the two newly-added categories must render
    expect(container.textContent).toContain("Annuity");
    expect(container.textContent).toContain("Stock options");
  });
});

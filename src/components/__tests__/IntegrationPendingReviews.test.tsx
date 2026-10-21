// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { IntegrationPendingReviews } from "../IntegrationPendingReviews";

const review = {
  importId: "imp-1",
  clientId: "client-1",
  householdName: "Denise McCormick",
  accountCount: 9,
};

describe("IntegrationPendingReviews", () => {
  it("renders nothing when no synced accounts are waiting", () => {
    const { container } = render(<IntegrationPendingReviews label="Addepar" reviews={[]} />);

    expect(container.innerHTML).toBe("");
  });

  it("links each waiting household straight to its review", () => {
    const { getByRole, getByText } = render(
      <IntegrationPendingReviews label="Addepar" reviews={[review]} />,
    );

    expect(getByText("Waiting for your review")).toBeTruthy();
    const link = getByRole("link", { name: "Review 9 accounts for Denise McCormick" });
    expect(link.getAttribute("href")).toBe("/clients/client-1/details/import/imp-1");
  });

  it("says 'account' for a single one", () => {
    const { getByRole } = render(
      <IntegrationPendingReviews label="Addepar" reviews={[{ ...review, accountCount: 1 }]} />,
    );

    expect(getByRole("link", { name: "Review 1 account for Denise McCormick" })).toBeTruthy();
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AccountCard, type AccountCardData } from "../account-card";

const card = (over: Partial<AccountCardData>): AccountCardData => ({
  id: "a1",
  name: "Joint Brokerage",
  last4: null,
  subtitle: "Taxable · Joint",
  value: 10_000,
  linkedSource: null,
  ...over,
});

describe("AccountCard connected-account icon", () => {
  it("draws the link icon before the name of an integration-synced account", () => {
    render(<AccountCard card={card({ linkedSource: "orion" })} onOpen={vi.fn()} />);

    const icon = screen.getByRole("img", { name: "Synced from Orion" });
    const name = screen.getByText("Joint Brokerage");
    expect(icon.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The right-hand source line names the integration instead of "Manual".
    expect(screen.getByText("Orion")).toBeTruthy();
    expect(screen.queryByText("Manual")).toBeNull();
  });

  it("draws it for a Plaid-linked account too", () => {
    render(<AccountCard card={card({ linkedSource: "plaid" })} onOpen={vi.fn()} />);

    expect(screen.getByRole("img", { name: "Linked via Plaid" })).toBeTruthy();
    expect(screen.getByText("Plaid")).toBeTruthy();
  });

  it("leaves a hand-entered account bare", () => {
    render(<AccountCard card={card({})} onOpen={vi.fn()} />);

    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("Manual")).toBeTruthy();
  });
});

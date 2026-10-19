// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { AccountCard, type AccountCardData } from "../account-card";

const ORION = { source: "orion", syncedAt: "2026-10-14T19:42:00.000Z", issue: null } as const;

const card = (over: Partial<AccountCardData>): AccountCardData => ({
  id: "a1",
  name: "Joint Brokerage",
  last4: null,
  subtitle: "Taxable · Joint",
  value: 10_000,
  linked: null,
  ...over,
});

describe("AccountCard connected-account icon", () => {
  it("draws the link icon before the name of an integration-synced account", () => {
    render(<AccountCard card={card({ linked: ORION })} onOpen={vi.fn()} />);

    const icon = screen.getByRole("img", { name: /^Synced from Orion/ });
    const name = screen.getByText("Joint Brokerage");
    expect(icon.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The right-hand source line names the integration instead of "Manual".
    expect(screen.getByText("Orion")).toBeTruthy();
    expect(screen.queryByText("Manual")).toBeNull();
  });

  it("draws it for a Plaid-linked account too", () => {
    render(
      <AccountCard card={card({ linked: { source: "plaid", syncedAt: null, issue: "revoked" } })} onOpen={vi.fn()} />,
    );

    expect(screen.getByRole("img", { name: "Linked via Plaid. Not synced yet. Access revoked" })).toBeTruthy();
    expect(screen.getByText("Plaid")).toBeTruthy();
  });

  it("leaves a hand-entered account bare", () => {
    render(<AccountCard card={card({})} onOpen={vi.fn()} />);

    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("Manual")).toBeTruthy();
  });

  // The server cannot know the viewer's time zone: its HTML leaves the time
  // out, so hydration matches and the browser adds it in its own zone.
  it("leaves the time out of the server render", () => {
    const html = renderToString(<AccountCard card={card({ linked: ORION })} onOpen={vi.fn()} />);

    expect(html).toContain('title="Synced from Orion"');
    expect(html).not.toContain("Last updated");
  });
});

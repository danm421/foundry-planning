// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import EntitlementsClient, { type EntitlementRow } from "../entitlements-client";

vi.mock("../actions", () => ({
  toggleEntitlementAction: vi.fn(),
  toggleUserEntitlementAction: vi.fn(),
}));

const row = (over: Partial<EntitlementRow> = {}): EntitlementRow => ({
  key: "client_portal",
  label: "Client portal",
  description: "Clients sign in to their own portal.",
  enabled: false,
  overrideMode: null,
  reason: null,
  setBy: null,
  createdAt: null,
  ...over,
});

describe("EntitlementsClient", () => {
  it("clears the reason once the change lands, so a grant's reason never pre-fills the revoke", () => {
    const { rerender } = render(<EntitlementsClient firmId="org_firm" rows={[row()]} />);
    fireEvent.change(screen.getByLabelText("Reason to grant Client portal"), {
      target: { value: "help video" },
    });
    // The server action revalidates; the row comes back flipped.
    rerender(
      <EntitlementsClient
        firmId="org_firm"
        rows={[row({ enabled: true, overrideMode: "grant", reason: "help video" })]}
      />,
    );
    const revokeReason = screen.getByLabelText("Reason to revoke Client portal") as HTMLInputElement;
    expect(revokeReason.value).toBe("");
  });
});

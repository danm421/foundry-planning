// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PortalPrivacy } from "@/lib/portal/privacy";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/components/portal/portal-mode-context", () => ({
  usePortalFetch: () => vi.fn(),
}));

vi.mock("react-plaid-link", () => ({
  usePlaidLink: () => ({ open: vi.fn(), ready: false }),
}));

vi.mock("@/components/portal/manage-accounts-dialog", () => ({
  ManageAccountsDialog: () => null,
}));

// InstitutionsSection is an async server component that reads the DB. Stub the
// DB round-trip only — the real InstitutionRow renders underneath, so "no
// Unlink button" is an assertion about the markup an advisor would actually
// see, not about a stub. `editEnabled` is forwarded verbatim, which is the
// value PortalSettingsView computes from `editEnabled && !readOnly`.
vi.mock("@/components/portal/institutions-section", async () => {
  const { InstitutionRow } = await vi.importActual<
    typeof import("@/components/portal/institution-row")
  >("@/components/portal/institution-row");
  return {
    InstitutionsSection: ({ editEnabled }: { clientId: string; editEnabled: boolean }) => (
      <ul>
        <InstitutionRow
          itemId="item-1"
          institutionName="Tartan Bank"
          statusLabel="Last refreshed just now"
          needsReauth={false}
          revoked={false}
          newAccountsAvailable={false}
          editEnabled={editEnabled}
          needsTransactionsConsent={false}
        />
      </ul>
    ),
  };
});

const privacy: PortalPrivacy = {
  shareTransactions: true,
  shareBudgets: true,
  shareRecurrings: true,
};

describe("PortalSettingsView — Connections authorization gate", () => {
  it("advisor preview (readOnly) renders no institution actions even when edit is enabled", async () => {
    const { PortalSettingsView } = await import("../portal-settings-view");
    render(
      await PortalSettingsView({
        privacy,
        clientId: "client-1",
        editEnabled: true,
        readOnly: true,
      }),
    );

    // The card and its institution are visible...
    expect(screen.getByText("Connections")).toBeInTheDocument();
    expect(screen.getByText("Tartan Bank")).toBeInTheDocument();

    // ...but nothing that mutates the client's linked institution is.
    expect(screen.queryByRole("button", { name: /unlink/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /refresh/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /manage/i })).toBeNull();
  });

  it("the client's own settings page (no readOnly) keeps the actions", async () => {
    const { PortalSettingsView } = await import("../portal-settings-view");
    render(
      await PortalSettingsView({
        privacy,
        clientId: "client-1",
        editEnabled: true,
      }),
    );

    // Control for the assertions above: with readOnly off, these same queries
    // do find the actions — so their absence in the preview case is the gate
    // working, not the queries failing to see a button that is there.
    expect(screen.getByRole("button", { name: /unlink/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /refresh/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /manage/i })).toBeInTheDocument();
  });
});

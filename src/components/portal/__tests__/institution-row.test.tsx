// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const portalFetchMock = vi.fn();
vi.mock("@/components/portal/portal-mode-context", () => ({
  usePortalFetch: () => portalFetchMock,
}));

vi.mock("react-plaid-link", () => ({
  usePlaidLink: () => ({ open: vi.fn(), ready: false }),
}));

vi.mock("../manage-accounts-dialog", () => ({
  ManageAccountsDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="manage-dialog">
      <button onClick={onClose}>close</button>
    </div>
  ),
}));

const baseProps = {
  itemId: "item-1",
  institutionName: "Tartan Bank",
  statusLabel: "Last refreshed just now",
  needsReauth: false,
  revoked: false,
  newAccountsAvailable: false,
  editEnabled: true,
  needsTransactionsConsent: false,
};

describe("InstitutionRow", () => {
  it("Manage button opens the dialog", async () => {
    const { InstitutionRow } = await import("../institution-row");
    render(<InstitutionRow {...baseProps} />);
    expect(screen.queryByTestId("manage-dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /manage/i }));
    expect(screen.getByTestId("manage-dialog")).toBeInTheDocument();
  });

  it("revoked: shows Access revoked and only the Unlink action", async () => {
    const { InstitutionRow } = await import("../institution-row");
    render(<InstitutionRow {...baseProps} revoked statusLabel="Access revoked" />);
    expect(screen.getByText("Access revoked")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /unlink/i })).toBeInTheDocument();
    expect(screen.queryByText(/re-authenticate/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /refresh/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /manage/i })).not.toBeInTheDocument();
  });

  it("newAccountsAvailable: shows prompt, Find more accounts, and dismiss", async () => {
    const { InstitutionRow } = await import("../institution-row");
    render(<InstitutionRow {...baseProps} newAccountsAvailable />);
    expect(screen.getByText(/new accounts available/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText(/find more accounts/i)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    await waitFor(() =>
      expect(portalFetchMock).toHaveBeenCalledWith(
        "/api/portal/plaid/items/item-1/dismiss-new-accounts",
        { method: "POST" },
      ),
    );
  });
});

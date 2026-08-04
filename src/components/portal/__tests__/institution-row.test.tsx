// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
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

afterEach(() => {
  portalFetchMock.mockClear();
});

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

  it("editEnabled=false: the whole action cluster is absent", async () => {
    const { InstitutionRow } = await import("../institution-row");
    const on = render(<InstitutionRow {...baseProps} />);
    // Control: with edit on, these queries do find the actions.
    expect(screen.getByRole("button", { name: /refresh/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /manage/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /unlink/i })).toBeInTheDocument();
    on.unmount();

    render(<InstitutionRow {...baseProps} editEnabled={false} />);
    // The institution is still listed — only the mutating actions are gone.
    expect(screen.getByText("Tartan Bank")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /refresh/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /manage/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /unlink/i })).toBeNull();
  });

  it("editEnabled=false: no re-authenticate affordance for a row that needs one", async () => {
    const { InstitutionRow } = await import("../institution-row");
    // Control first: with edit on, the lazily-loaded re-auth button arrives.
    // This also warms next/dynamic's module cache, so if the guard below let
    // the button through it would render immediately rather than a tick later
    // — which is what makes the negative assertion non-vacuous.
    const on = render(
      <InstitutionRow {...baseProps} needsReauth statusLabel="Re-auth required" />,
    );
    await waitFor(() =>
      expect(screen.getByText(/re-authenticate/i)).toBeInTheDocument(),
    );
    on.unmount();

    render(
      <InstitutionRow
        {...baseProps}
        needsReauth
        statusLabel="Re-auth required"
        editEnabled={false}
      />,
    );
    expect(screen.getByText("Re-auth required")).toBeInTheDocument();
    expect(screen.queryByText(/re-authenticate/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /unlink/i })).toBeNull();
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

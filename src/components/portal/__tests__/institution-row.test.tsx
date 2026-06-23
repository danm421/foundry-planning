// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/components/portal/portal-mode-context", () => ({
  usePortalFetch: () => vi.fn(),
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

describe("InstitutionRow", () => {
  it("Manage button opens the dialog", async () => {
    const { InstitutionRow } = await import("../institution-row");
    render(
      <InstitutionRow
        itemId="item-1"
        institutionName="Tartan Bank"
        statusLabel="Last refreshed just now"
        needsReauth={false}
        editEnabled
        needsTransactionsConsent={false}
      />,
    );
    expect(screen.queryByTestId("manage-dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /manage/i }));
    expect(screen.getByTestId("manage-dialog")).toBeInTheDocument();
  });
});

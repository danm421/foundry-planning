// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
// The dialog itself is covered by share-dialog.test.tsx — stub it here.
vi.mock("@/components/sharing/share-dialog", () => ({
  default: ({ open, clientId }: { open: boolean; clientId: string }) =>
    open ? <div data-testid="share-dialog">{clientId}</div> : null,
}));

import { SharingPanels } from "../sharing-panels";

const SHAREABLE = [
  { id: "c1", name: "Cooper Household", isPrivate: false },
  { id: "c2", name: "Baker Household", isPrivate: true },
];

describe("IndividualSharesPanel share-a-client picker", () => {
  beforeEach(() => vi.clearAllMocks());

  function renderPanels() {
    render(<SharingPanels outgoing={[]} incoming={[]} shareableClients={SHAREABLE} />);
  }

  it("disables Share until a client is picked", () => {
    renderPanels();
    expect(screen.getByRole("button", { name: "Share…" })).toBeDisabled();
  });

  it("opens the share dialog for the picked client", () => {
    renderPanels();
    fireEvent.change(screen.getByLabelText("Client to share"), { target: { value: "c2" } });
    fireEvent.click(screen.getByRole("button", { name: "Share…" }));
    expect(screen.getByTestId("share-dialog")).toHaveTextContent("c2");
  });
});

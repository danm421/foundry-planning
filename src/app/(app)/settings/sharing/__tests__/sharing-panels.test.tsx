// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

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

describe("ShareAllPanel firm member picker", () => {
  const member = (userId: string, displayName: string, email: string) => ({
    userId,
    displayName,
    email,
    imageUrl: null,
    role: "Member",
    roleKey: "org:member",
  });
  const MEMBERS = [
    member("u-ann", "Ann Park", "ann@firm.com"),
    member("u-bob", "Bob Reyes", "bob@firm.com"),
  ];

  beforeEach(() => vi.clearAllMocks());

  it("adds a share-all grant for a picked firm member", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            share: {
              id: "s1",
              recipientEmail: "bob@firm.com",
              permission: "view",
              scope: "all",
              clientId: null,
              clientName: null,
            },
          }),
      } as Response),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<SharingPanels outgoing={[]} incoming={[]} shareableClients={[]} firmMembers={MEMBERS} />);

    fireEvent.focus(screen.getByPlaceholderText("Name or email"));
    fireEvent.click(screen.getByRole("option", { name: /bob reyes/i }));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(screen.getByRole("cell", { name: "bob@firm.com" })).toBeInTheDocument());
    const [url, opts] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/shares");
    expect(JSON.parse(opts.body as string)).toEqual({ email: "bob@firm.com", permission: "view" });
  });

  it("does not offer someone who already has the whole book", () => {
    render(
      <SharingPanels
        outgoing={[
          {
            id: "s1",
            recipientEmail: "ann@firm.com",
            permission: "view",
            scope: "all",
            clientId: null,
            clientName: null,
          },
        ]}
        incoming={[]}
        shareableClients={[]}
        firmMembers={MEMBERS}
      />,
    );
    fireEvent.focus(screen.getByPlaceholderText("Name or email"));
    expect(screen.queryByRole("option", { name: /ann park/i })).toBeNull();
    expect(screen.getByRole("option", { name: /bob reyes/i })).toBeInTheDocument();
  });
});

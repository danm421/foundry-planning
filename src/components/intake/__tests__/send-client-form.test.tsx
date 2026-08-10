// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SendClientForm from "../send-client-form";

const mockRefresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const defaultProps = {
  clientId: "client-abc",
  primaryEmail: "jane@example.com",
  primaryName: "Jane Smith",
  clientAlreadyBound: false,
  pendingFormId: null,
  portalEnabled: true,
};

describe("SendClientForm", () => {
  beforeEach(() => {
    mockRefresh.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }),
    );
  });

  it("renders both Blank and Pre-filled buttons, and the recipient email pre-filled", () => {
    render(<SendClientForm {...defaultProps} />);
    expect(screen.getByRole("button", { name: /send blank form/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send pre-filled form/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/recipient email/i)).toHaveValue("jane@example.com");
  });

  it("hides the Pre-filled button when the firm has no client portal, keeping Blank", () => {
    // Pre-filled is delivered as a portal invite; blank is a tokenized email
    // link, so it survives. Both emission paths, not just the visible state.
    render(<SendClientForm {...defaultProps} portalEnabled={false} />);
    expect(screen.queryByRole("button", { name: /send pre-filled form/i })).toBeNull();
    expect(screen.getByRole("button", { name: /send blank form/i })).toBeInTheDocument();
  });

  it("drops the already-bound portal hint when the firm has no client portal", () => {
    render(
      <SendClientForm {...defaultProps} portalEnabled={false} clientAlreadyBound />,
    );
    expect(screen.queryByText(/already has portal access/i)).toBeNull();
  });

  it("submitting Blank calls POST /api/data-collection with mode:blank", async () => {
    render(<SendClientForm {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: /send blank form/i }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/data-collection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "blank",
          clientId: "client-abc",
          recipientEmail: "jane@example.com",
          recipientName: "Jane Smith",
          sections: ["family", "accounts", "income", "property", "goals", "documents"],
        }),
      });
    });
  });

  it("submitting Pre-filled calls POST /api/data-collection with mode:prefilled", async () => {
    render(<SendClientForm {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: /send pre-filled form/i }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/data-collection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "prefilled",
          clientId: "client-abc",
          recipientEmail: "jane@example.com",
          recipientName: "Jane Smith",
        }),
      });
    });
  });

  it("sends the picked set on a blank send", async () => {
    render(<SendClientForm {...defaultProps} defaultSections={["family", "documents"]} />);
    fireEvent.click(screen.getByRole("button", { name: /send blank form/i }));

    await waitFor(() => {
      const post = vi.mocked(fetch).mock.calls[0];
      expect(JSON.parse(post[1]!.body as string).sections).toEqual(["family", "documents"]);
    });
  });

  it("omits sections on a pre-filled send even when the picker was changed", async () => {
    // A pre-filled send is a portal invite; the portal wizard reads the seeded
    // form row. Storing a reduced set here is what the create route rejects as
    // undeliverable, so the picker must not reach this body at all.
    render(<SendClientForm {...defaultProps} defaultSections={["family", "documents"]} />);
    fireEvent.click(screen.getByRole("button", { name: /send pre-filled form/i }));

    await waitFor(() => {
      const post = vi.mocked(fetch).mock.calls[0];
      expect(JSON.parse(post[1]!.body as string)).not.toHaveProperty("sections");
    });
  });

  it("shows inline error and does not call fetch for an invalid email", async () => {
    render(<SendClientForm {...defaultProps} primaryEmail="" />);
    fireEvent.change(screen.getByLabelText(/recipient email/i), {
      target: { value: "not-an-email" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send blank form/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/valid email/i);
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("renders the pending-review link when pendingFormId is set", () => {
    render(<SendClientForm {...defaultProps} pendingFormId="form-xyz" />);
    const link = screen.getByRole("link", { name: /submitted form awaiting review/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/data-collection/form-xyz");
  });

  it("does not render the pending-review link when pendingFormId is null", () => {
    render(<SendClientForm {...defaultProps} pendingFormId={null} />);
    expect(
      screen.queryByRole("link", { name: /submitted form awaiting review/i }),
    ).not.toBeInTheDocument();
  });

  it("shows the spouse email toggle when spouseEmail is present", () => {
    render(<SendClientForm {...defaultProps} spouseEmail="spouse@example.com" />);
    expect(screen.getByRole("button", { name: /use spouse email/i })).toBeInTheDocument();
  });

  it("switches to spouse email on toggle click", () => {
    render(
      <SendClientForm
        {...defaultProps}
        primaryEmail="jane@example.com"
        spouseEmail="spouse@example.com"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /use spouse email/i }));
    expect(screen.getByLabelText(/recipient email/i)).toHaveValue("spouse@example.com");
  });

  it("calls router.refresh() after a successful blank send", async () => {
    render(<SendClientForm {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: /send blank form/i }));

    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalledTimes(1);
    });
  });

  it("posts recipientName: spouseName when sending to the spouse email", async () => {
    render(
      <SendClientForm
        {...defaultProps}
        primaryEmail="jane@example.com"
        primaryName="Jane Smith"
        spouseEmail="spouse@example.com"
        spouseName="Bob Smith"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /use spouse email/i }));
    fireEvent.click(screen.getByRole("button", { name: /send blank form/i }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/data-collection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "blank",
          clientId: "client-abc",
          recipientEmail: "spouse@example.com",
          recipientName: "Bob Smith",
          sections: ["family", "accounts", "income", "property", "goals", "documents"],
        }),
      });
    });
  });

  it("posts recipientName: primaryName when sending to the primary email (default path)", async () => {
    render(
      <SendClientForm
        {...defaultProps}
        primaryEmail="jane@example.com"
        primaryName="Jane Smith"
        spouseEmail="spouse@example.com"
        spouseName="Bob Smith"
      />,
    );
    // No toggle — stays on primary email
    fireEvent.click(screen.getByRole("button", { name: /send blank form/i }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/data-collection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "blank",
          clientId: "client-abc",
          recipientEmail: "jane@example.com",
          recipientName: "Jane Smith",
          sections: ["family", "accounts", "income", "property", "goals", "documents"],
        }),
      });
    });
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SendClientForm from "../send-client-form";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
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
};

describe("SendClientForm", () => {
  beforeEach(() => {
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
});

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IntegrationConnectionCard } from "../IntegrationConnectionCard";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/toast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

describe("IntegrationConnectionCard BYOK", () => {
  beforeEach(() => { global.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown as typeof fetch; });

  it("shows a credential form (not an OAuth link) for a disconnected byok provider", () => {
    render(<IntegrationConnectionCard providerId="addepar" label="Addepar" authKind="byok" status="disconnected" lastSyncedAt={null} lastSyncError={null} />);
    expect(screen.getByLabelText(/api key/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /connect addepar/i })).toBeNull();
  });

  it("starts the address empty, showing a firm's own Addepar address as the example", () => {
    render(<IntegrationConnectionCard providerId="addepar" label="Addepar" authKind="byok" status="disconnected" lastSyncedAt={null} lastSyncError={null} />);
    const address = screen.getByLabelText(/api base url/i);
    expect(address).toHaveValue("");
    expect(address).toHaveAttribute("placeholder", "https://yourfirm.addepar.com");
  });

  it("tells the admin where Addepar shows the firm ID", () => {
    render(<IntegrationConnectionCard providerId="addepar" label="Addepar" authKind="byok" status="disconnected" lastSyncedAt={null} lastSyncError={null} />);
    expect(screen.getByLabelText(/addepar firm id/i)).toHaveAccessibleDescription(
      /Analysis.*Export.*Generate API URL.*addepar_firm=/,
    );
  });

  it("blocks Connect until attestation is checked", () => {
    render(<IntegrationConnectionCard providerId="addepar" label="Addepar" authKind="byok" status="disconnected" lastSyncedAt={null} lastSyncError={null} />);
    expect(screen.getByRole("button", { name: /^connect$/i })).toBeDisabled();
  });

  // jsdom can't compute Tailwind, so this pins the classes: without them a
  // disabled .btn-primary looks exactly like a live one (Dan clicked a dead
  // Connect on prod and saw nothing happen).
  it("fades its buttons while they can't be used", () => {
    render(<IntegrationConnectionCard providerId="addepar" label="Addepar" authKind="byok" status="disconnected" lastSyncedAt={null} lastSyncError={null} />);
    expect(screen.getByRole("button", { name: /^connect$/i })).toHaveClass("disabled:opacity-50");
    expect(screen.getByRole("button", { name: /test connection/i })).toHaveClass("disabled:opacity-50");
  });

  it("after a passed test, says to tick the confirmation box until it is ticked", async () => {
    const user = userEvent.setup();
    render(<IntegrationConnectionCard providerId="addepar" label="Addepar" authKind="byok" status="disconnected" lastSyncedAt={null} lastSyncError={null} />);
    await user.type(screen.getByLabelText(/api base url/i), "https://ethos.addepar.com");
    await user.type(screen.getByLabelText(/addepar firm id/i), "1069");
    await user.type(screen.getByLabelText(/api key/i), "key");
    await user.type(screen.getByLabelText(/api secret/i), "secret");
    await user.click(screen.getByRole("button", { name: /test connection/i }));

    expect(await screen.findByText(/connection verified/i)).toBeInTheDocument();
    expect(screen.getByText(/tick the confirmation box to connect/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^connect$/i })).toBeDisabled();

    await user.click(screen.getByRole("checkbox"));
    expect(screen.queryByText(/tick the confirmation box to connect/i)).toBeNull();
    expect(screen.getByRole("button", { name: /^connect$/i })).toBeEnabled();
  });

  it("still renders an OAuth link for an oauth provider", () => {
    render(<IntegrationConnectionCard providerId="orion" label="Orion" authKind="oauth" status="disconnected" lastSyncedAt={null} lastSyncError={null} />);
    expect(screen.getByRole("link", { name: /connect orion/i })).toHaveAttribute("href", "/api/integrations/orion/connect");
  });
});

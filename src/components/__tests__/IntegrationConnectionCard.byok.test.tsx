// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { IntegrationConnectionCard } from "../IntegrationConnectionCard";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/toast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

describe("IntegrationConnectionCard BYOK", () => {
  beforeEach(() => { global.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown as typeof fetch; });

  it("shows a credential form (not an OAuth link) for a disconnected byok provider", () => {
    render(<IntegrationConnectionCard providerId="addepar" label="Addepar" enabled authKind="byok" status="disconnected" lastSyncedAt={null} lastSyncError={null} />);
    expect(screen.getByLabelText(/api key/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /connect addepar/i })).toBeNull();
  });

  it("blocks Connect until attestation is checked", () => {
    render(<IntegrationConnectionCard providerId="addepar" label="Addepar" enabled authKind="byok" status="disconnected" lastSyncedAt={null} lastSyncError={null} />);
    expect(screen.getByRole("button", { name: /^connect$/i })).toBeDisabled();
  });

  it("still renders an OAuth link for an oauth provider", () => {
    render(<IntegrationConnectionCard providerId="orion" label="Orion" enabled authKind="oauth" status="disconnected" lastSyncedAt={null} lastSyncError={null} />);
    expect(screen.getByRole("link", { name: /connect orion/i })).toHaveAttribute("href", "/api/integrations/orion/connect");
  });
});

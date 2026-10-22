// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IntegrationConnectionCard, ByokConnectForm } from "../IntegrationConnectionCard";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push }) }));
vi.mock("@/components/toast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

describe("IntegrationConnectionCard BYOK", () => {
  beforeEach(() => { push.mockClear(); global.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown as typeof fetch; });

  it("shows a credential form (not an OAuth link) for a disconnected byok provider", () => {
    render(<IntegrationConnectionCard connectionId="c1" name="Ethos" providerId="addepar" label="Addepar" authKind="byok" status="disconnected" lastSyncedAt={null} lastSyncError={null} />);
    expect(screen.getByLabelText(/api key/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /connect addepar/i })).toBeNull();
  });

  it("starts the address empty, showing a firm's own Addepar address as the example", () => {
    render(<IntegrationConnectionCard connectionId="c1" name="Ethos" providerId="addepar" label="Addepar" authKind="byok" status="disconnected" lastSyncedAt={null} lastSyncError={null} />);
    const address = screen.getByLabelText(/api base url/i);
    expect(address).toHaveValue("");
    expect(address).toHaveAttribute("placeholder", "https://yourfirm.addepar.com");
  });

  it("tells the admin where Addepar shows the firm ID", () => {
    render(<IntegrationConnectionCard connectionId="c1" name="Ethos" providerId="addepar" label="Addepar" authKind="byok" status="disconnected" lastSyncedAt={null} lastSyncError={null} />);
    expect(screen.getByLabelText(/addepar firm id/i)).toHaveAccessibleDescription(
      /Analysis.*Export.*Generate API URL.*addepar_firm=/,
    );
  });

  it("blocks Connect until attestation is checked", () => {
    render(<IntegrationConnectionCard connectionId="c1" name="Ethos" providerId="addepar" label="Addepar" authKind="byok" status="disconnected" lastSyncedAt={null} lastSyncError={null} />);
    expect(screen.getByRole("button", { name: /^reconnect$/i })).toBeDisabled();
  });

  // jsdom can't compute Tailwind, so this pins the classes: without them a
  // disabled .btn-primary looks exactly like a live one (Dan clicked a dead
  // Connect on prod and saw nothing happen).
  it("fades its buttons while they can't be used", () => {
    render(<IntegrationConnectionCard connectionId="c1" name="Ethos" providerId="addepar" label="Addepar" authKind="byok" status="disconnected" lastSyncedAt={null} lastSyncError={null} />);
    expect(screen.getByRole("button", { name: /^reconnect$/i })).toHaveClass("disabled:opacity-50");
    expect(screen.getByRole("button", { name: /test connection/i })).toHaveClass("disabled:opacity-50");
  });

  it("after a passed test, says to tick the confirmation box until it is ticked", async () => {
    const user = userEvent.setup();
    render(<IntegrationConnectionCard connectionId="c1" name="Ethos" providerId="addepar" label="Addepar" authKind="byok" status="disconnected" lastSyncedAt={null} lastSyncError={null} />);
    await user.type(screen.getByLabelText(/api base url/i), "https://ethos.addepar.com");
    await user.type(screen.getByLabelText(/addepar firm id/i), "1069");
    await user.type(screen.getByLabelText(/api key/i), "key");
    await user.type(screen.getByLabelText(/api secret/i), "secret");
    await user.click(screen.getByRole("button", { name: /test connection/i }));

    expect(await screen.findByText(/connection verified/i)).toBeInTheDocument();
    expect(screen.getByText(/tick the confirmation box to connect/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^reconnect$/i })).toBeDisabled();

    await user.click(screen.getByRole("checkbox"));
    expect(screen.queryByText(/tick the confirmation box to connect/i)).toBeNull();
    expect(screen.getByRole("button", { name: /^reconnect$/i })).toBeEnabled();
  });

  it("still renders an OAuth link for an oauth provider", () => {
    render(<IntegrationConnectionCard connectionId="c1" name="Ethos" providerId="orion" label="Orion" authKind="oauth" status="disconnected" lastSyncedAt={null} lastSyncError={null} />);
    expect(screen.getByRole("link", { name: /connect orion/i })).toHaveAttribute("href", "/api/integrations/orion/connect");
  });

  it("Sync posts to the connection's sync route", async () => {
    const user = userEvent.setup();
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ committed: 2, queued: 1 }), { status: 200 }));
    global.fetch = fetchFn as unknown as typeof fetch;
    render(<IntegrationConnectionCard connectionId="c1" name="Ethos" providerId="addepar" label="Addepar" authKind="byok" status="connected" lastSyncedAt={null} lastSyncError={null} />);

    await user.click(screen.getByRole("button", { name: /sync now/i }));

    expect(fetchFn).toHaveBeenCalledWith("/api/integrations/addepar/connections/c1/sync", expect.objectContaining({ method: "POST" }));
  });

  it("Disconnect posts to the connection's disconnect route", async () => {
    const user = userEvent.setup();
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    global.fetch = fetchFn as unknown as typeof fetch;
    render(<IntegrationConnectionCard connectionId="c1" name="Ethos" providerId="addepar" label="Addepar" authKind="byok" status="connected" lastSyncedAt={null} lastSyncError={null} />);

    await user.click(screen.getByRole("button", { name: /^disconnect$/i }));

    expect(fetchFn).toHaveBeenCalledWith("/api/integrations/addepar/connections/c1/disconnect", { method: "POST" });
  });

  it("offers Delete only when the connection is disconnected or broken", () => {
    const { rerender } = render(<IntegrationConnectionCard connectionId="c1" name="Ethos" providerId="addepar" label="Addepar" authKind="byok" status="connected" lastSyncedAt={null} lastSyncError={null} />);
    expect(screen.queryByRole("button", { name: /^delete$/i })).toBeNull();

    rerender(<IntegrationConnectionCard connectionId="c1" name="Ethos" providerId="addepar" label="Addepar" authKind="byok" status="error" lastSyncedAt={null} lastSyncError="401" />);
    expect(screen.getByRole("button", { name: /^delete$/i })).toBeInTheDocument();

    rerender(<IntegrationConnectionCard connectionId="c1" name="Ethos" providerId="addepar" label="Addepar" authKind="byok" status="disconnected" lastSyncedAt={null} lastSyncError={null} />);
    expect(screen.getByRole("button", { name: /^delete$/i })).toBeInTheDocument();
  });

  it("Delete asks first, then deletes", async () => {
    const user = userEvent.setup();
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    global.fetch = fetchFn as unknown as typeof fetch;
    render(<IntegrationConnectionCard connectionId="c1" name="Ethos" providerId="addepar" label="Addepar" authKind="byok" status="disconnected" lastSyncedAt={null} lastSyncError={null} />);

    await user.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(fetchFn).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: /delete ethos/i });

    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    expect(fetchFn).toHaveBeenCalledWith("/api/integrations/addepar/connections/c1", { method: "DELETE" });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/settings/integrations/addepar"));
  });

  it("reconnects through the connection's credentials route, keeping its name", async () => {
    const user = userEvent.setup();
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    global.fetch = fetchFn as unknown as typeof fetch;
    render(<IntegrationConnectionCard connectionId="c1" name="Ethos" providerId="addepar" label="Addepar" authKind="byok" status="error" lastSyncedAt={null} lastSyncError="401" />);
    expect(screen.getByLabelText(/^name$/i)).toHaveValue("Ethos");
    await user.type(screen.getByLabelText(/api base url/i), "https://ethos.addepar.com");
    await user.type(screen.getByLabelText(/addepar firm id/i), "1069");
    await user.type(screen.getByLabelText(/api key/i), "key");
    await user.type(screen.getByLabelText(/api secret/i), "secret");
    await user.click(screen.getByRole("button", { name: /test connection/i }));
    await screen.findByText(/connection verified/i);
    await user.click(screen.getByRole("checkbox"));

    await user.click(screen.getByRole("button", { name: /^reconnect$/i }));

    const call = fetchFn.mock.calls.find((c) => String(c[0]).endsWith("/connections/c1/credentials"));
    expect(call).toBeTruthy();
    expect(JSON.parse((call![1] as RequestInit).body as string)).toMatchObject({ name: "Ethos", attestation: true });
  });
});

describe("ByokConnectForm (adding a connection)", () => {
  beforeEach(() => { push.mockClear(); });

  it("the name prefills from the API base until the advisor edits it", async () => {
    const user = userEvent.setup();
    render(<ByokConnectForm providerId="addepar" label="Addepar" />);
    const name = screen.getByLabelText(/^name$/i);
    expect(name).toHaveValue("");

    await user.type(screen.getByLabelText(/api base url/i), "https://ethos.addepar.com");
    expect(name).toHaveValue("Ethos");

    await user.clear(name);
    await user.type(name, "Family office");
    await user.type(screen.getByLabelText(/api base url/i), "/x");
    expect(name).toHaveValue("Family office");
    expect(name).toHaveAttribute("maxlength", "60");
    expect(name).toBeRequired();
  });

  it("connects through the connect route and opens the new connection's page", async () => {
    const user = userEvent.setup();
    const fetchFn = vi.fn(async (url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(url.endsWith("/connect") ? { ok: true, connectionId: "new-1" } : { ok: true }), { status: 200 }),
    );
    global.fetch = fetchFn as unknown as typeof fetch;
    render(<ByokConnectForm providerId="addepar" label="Addepar" />);
    await user.type(screen.getByLabelText(/api base url/i), "https://ethos.addepar.com");
    await user.type(screen.getByLabelText(/addepar firm id/i), "1069");
    await user.type(screen.getByLabelText(/api key/i), "key");
    await user.type(screen.getByLabelText(/api secret/i), "secret");
    await user.click(screen.getByRole("button", { name: /test connection/i }));
    await screen.findByText(/connection verified/i);
    await user.click(screen.getByRole("checkbox"));

    await user.click(screen.getByRole("button", { name: /^connect$/i }));

    const call = fetchFn.mock.calls.find((c) => c[0] === "/api/integrations/addepar/connect");
    expect(JSON.parse((call![1] as RequestInit).body as string)).toMatchObject({ name: "Ethos", attestation: true });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/settings/integrations/addepar/new-1"));
  });
});

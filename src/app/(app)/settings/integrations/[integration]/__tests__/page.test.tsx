// @vitest-environment jsdom
//
// The integration detail page is a server component that decides, per firm and
// per integration, what each management card is told. Nothing watched the Azure
// hand-off before: every prop below could be blanked — `errorDetail` flattened
// to `null`, the whole decoded config dropped — with the entire scoped suite
// green. The connected and error states are also unreachable in a browser today
// (no firm can connect while AZURE_OPENAI_EMBEDDINGS_DEPLOYMENT is unset), so
// without this file NOTHING, test or human, watches two of the card's three
// states.
//
// Shape follows the repo's own precedent for a server page:
// src/app/(app)/settings/branding/__tests__/page.test.tsx — replace the child
// with a marker that records exactly what the page decided to pass down.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";

const mockAuth = vi.fn();
const mockGetConnection = vi.fn();
const mockListOwned = vi.fn();
const mockPlaidUsage = vi.fn();
const mockApproval = vi.fn();
const mockFirmConnections = vi.fn();
const mockMembers = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({ auth: () => mockAuth() }));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

vi.mock("@/lib/integrations/connections", () => ({
  getConnection: (...a: unknown[]) => mockGetConnection(...a),
  listOwnedConnections: (...a: unknown[]) => mockListOwned(...a),
}));

vi.mock("@/lib/integrations/plaid-usage", () => ({
  getPlaidUsage: (...a: unknown[]) => mockPlaidUsage(...a),
}));

vi.mock("@/lib/workspace/approvals", () => ({
  getFirmApproval: (...a: unknown[]) => mockApproval(...a),
}));
vi.mock("@/lib/workspace/connections", () => ({
  listFirmConnections: (...a: unknown[]) => mockFirmConnections(...a),
}));
vi.mock("@/lib/crm-tasks/members", () => ({
  listFirmMembers: (...a: unknown[]) => mockMembers(...a),
}));
vi.mock("@/components/WorkspaceAdminCard", () => ({
  WorkspaceAdminCard: (p: {
    approval: { approvedAt: string } | null;
    members: {
      userId: string;
      displayName: string;
      accounts: { connectionId: string; provider: string; email: string; status: string }[];
    }[];
    flash: string | null;
  }) => (
    <div
      data-testid="ws-card"
      data-approved-at={p.approval?.approvedAt ?? ""}
      data-flash={p.flash ?? ""}
      data-members={p.members
        .map(
          (m) =>
            `${m.userId}=${m.displayName}=${m.accounts
              .map((a) => `${a.connectionId}:${a.provider}:${a.email}:${a.status}`)
              .join(",")}`,
        )
        .join("|")}
    />
  ),
}));

// Markers, not the real components. Every prop the page forwards becomes an
// observable attribute, so a prop that is dropped, flattened or swapped shows
// up as a wrong attribute value rather than as identical-looking markup.
vi.mock("@/components/AzureOpenAiCard", () => ({
  AzureOpenAiCard: (p: Record<string, string | null | undefined>) => (
    <div
      data-testid="azure-card"
      data-status={p.status ?? ""}
      data-endpoint={p.endpoint ?? ""}
      data-api-version={p.apiVersion ?? ""}
      data-chat-deployment={p.chatDeployment ?? ""}
      data-mini-deployment={p.miniDeployment ?? ""}
      data-embedding-deployment={p.embeddingDeployment ?? ""}
      data-connected-at={p.connectedAt ?? ""}
      data-error-detail={p.errorDetail ?? ""}
    />
  ),
}));
vi.mock("@/components/IntegrationConnectionList", () => ({
  IntegrationConnectionList: (p: {
    providerId: string;
    label: string;
    authKind: string;
    connections: { id: string; name: string }[];
  }) => (
    <div
      data-testid="connection-list"
      data-provider={p.providerId}
      data-label={p.label}
      data-auth-kind={p.authKind}
      data-names={p.connections.map((c) => c.name).join(",")}
      data-ids={p.connections.map((c) => c.id).join(",")}
    />
  ),
}));
vi.mock("@/components/PlaidIntegrationTile", () => ({
  PlaidIntegrationTile: (p: { clientCount: number; institutionCount: number }) => (
    <div
      data-testid="plaid-tile"
      data-clients={p.clientCount}
      data-institutions={p.institutionCount}
    />
  ),
}));

// DELIBERATELY UNMOCKED, and each for a reason a mock would destroy:
//  - "@/lib/integrations/registry" — the real registry is the only thing that
//    proves azure_openai carries `syncs: false`, which is what keeps it off the
//    sync card + household table path.
//  - "@/lib/ai/credentials" — decodeAzureConfig is the real codec, so the
//    corrupt-scope case genuinely exercises the page's try/catch instead of a
//    stub that throws on cue.
//  - the provider flag modules — each kill-switch reads process.env directly,
//    and stubEnv is a truer test of it than a mocked boolean.
import IntegrationDetailPage from "../page";

const FIRM_CONFIG = JSON.stringify({
  endpoint: "https://acme-ria.openai.azure.com",
  apiVersion: "2031-07-01",
  chatDeployment: "acme-main-model",
  miniDeployment: "acme-fast-model",
  embeddingDeployment: "acme-search-model",
});

/** A connection row as getConnection returns it (already decrypted). */
function azureRow(over: Record<string, unknown> = {}) {
  return {
    status: "connected",
    scope: FIRM_CONFIG,
    connectedAt: new Date("2026-08-27T12:00:00.000Z"),
    lastSyncedAt: null,
    lastSyncError: null,
    ...over,
  };
}

async function renderPage(
  integration = "azure_openai",
  searchParams: Record<string, string> = {},
) {
  return render(
    await IntegrationDetailPage({
      params: Promise.resolve({ integration }),
      searchParams: Promise.resolve(searchParams),
    }),
  );
}

function azureCard(container: HTMLElement) {
  return container.querySelector("[data-testid='azure-card']");
}

beforeEach(() => {
  vi.stubEnv("AZURE_BYOK_ENABLED", "true");
  vi.stubEnv("ADDEPAR_ENABLED", "true");
  vi.stubEnv("ORION_ENABLED", "false");
  mockAuth
    .mockReset()
    .mockResolvedValue({ orgId: "org_acme", userId: "user_dan", orgRole: "org:admin" });
  mockGetConnection.mockReset().mockResolvedValue(null);
  mockListOwned.mockReset().mockResolvedValue([]);
  mockPlaidUsage.mockReset().mockResolvedValue({ clientCount: 0, institutionCount: 0 });
  mockApproval.mockReset().mockResolvedValue(null);
  mockFirmConnections.mockReset().mockResolvedValue([]);
  mockMembers.mockReset().mockResolvedValue([]);
});

afterEach(() => vi.unstubAllEnvs());

describe("Integration detail — which pages exist", () => {
  it("404s an id that is not an integration", async () => {
    await expect(renderPage("not-a-provider")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mockGetConnection).not.toHaveBeenCalled();
  });

  it("404s a provider behind its kill-switch — there is nothing to set up yet", async () => {
    await expect(renderPage("orion")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mockGetConnection).not.toHaveBeenCalled();
  });

  it("404s Azure OpenAI while its flag is off, without reading its connection", async () => {
    vi.stubEnv("AZURE_BYOK_ENABLED", "false");

    await expect(renderPage("azure_openai")).rejects.toThrow("NEXT_NOT_FOUND");
    // Not just "no card": the read itself must not happen. The flag guards a
    // database round trip per page load, and a card rendered from a row that
    // was fetched anyway is a kill-switch that only hides the UI.
    expect(mockGetConnection).not.toHaveBeenCalled();
  });

  it("links back to the list", async () => {
    const { getByRole } = await renderPage("addepar");

    expect(getByRole("link", { name: /integrations/i }).getAttribute("href")).toBe(
      "/settings/integrations",
    );
    expect(getByRole("heading", { level: 1 }).textContent).toBe("Addepar");
  });
});

describe("Integration detail — a syncing provider", () => {
  it("lists the caller's connections", async () => {
    mockListOwned.mockResolvedValue([
      { id: "c-1", providerId: "addepar", name: "Ethos", status: "connected", lastSyncedAt: null, lastSyncError: null, linkedHouseholds: 2 },
      { id: "c-2", providerId: "addepar", name: null, status: "error", lastSyncedAt: null, lastSyncError: "401", linkedHouseholds: 0 },
    ]);

    const { container } = await renderPage("addepar");
    const list = container.querySelector("[data-testid='connection-list']");

    expect(mockListOwned).toHaveBeenCalledWith({
      firmId: "org_acme",
      userId: "user_dan",
      providerId: "addepar",
    });
    expect(list?.getAttribute("data-provider")).toBe("addepar");
    expect(list?.getAttribute("data-auth-kind")).toBe("byok");
    // A connection with no name shows the provider label.
    expect(list?.getAttribute("data-names")).toBe("Ethos,Addepar");
    expect(list?.getAttribute("data-ids")).toBe("c-1,c-2");
  });

  it("is open to a member and never reads the firm-level connection", async () => {
    mockAuth.mockResolvedValue({ orgId: "org_acme", userId: "user_ana", orgRole: "org:member" });

    const { container } = await renderPage("addepar");

    expect(container.querySelector("[data-testid='connection-list']")).toBeTruthy();
    expect(mockListOwned).toHaveBeenCalledWith(expect.objectContaining({ userId: "user_ana" }));
    expect(mockGetConnection).not.toHaveBeenCalled();
  });
});

describe("Integration detail — Plaid", () => {
  it("shows the firm's client-linked counts and reads no provider connection", async () => {
    mockPlaidUsage.mockResolvedValue({ clientCount: 3, institutionCount: 5 });

    const { container } = await renderPage("plaid");
    const tile = container.querySelector("[data-testid='plaid-tile']");

    expect(mockPlaidUsage).toHaveBeenCalledWith("org_acme");
    expect(tile?.getAttribute("data-clients")).toBe("3");
    expect(tile?.getAttribute("data-institutions")).toBe("5");
    expect(mockGetConnection).not.toHaveBeenCalled();
  });

  it("Plaid page is still admin-only", async () => {
    mockAuth.mockResolvedValue({ orgId: "org_acme", userId: "user_ana", orgRole: "org:member" });

    const { container } = await renderPage("plaid");

    expect(container.textContent ?? "").toContain("Not available for your role");
    expect(mockPlaidUsage).not.toHaveBeenCalled();
  });
});

describe("Integration detail — what the Azure card is told", () => {
  it("forwards every field of the stored config, not just the endpoint and main model", async () => {
    // The connected card is the artifact a firm shows its auditor, so all five
    // decoded fields have to survive the hand-off. A page that decoded the
    // config and forwarded a two-field slice of it passed every other test.
    mockGetConnection.mockResolvedValue(azureRow());

    const { container } = await renderPage();
    const card = azureCard(container);

    expect(mockGetConnection).toHaveBeenCalledWith("org_acme", "azure_openai");
    expect(card?.getAttribute("data-status")).toBe("connected");
    expect(card?.getAttribute("data-endpoint")).toBe("https://acme-ria.openai.azure.com");
    expect(card?.getAttribute("data-api-version")).toBe("2031-07-01");
    expect(card?.getAttribute("data-chat-deployment")).toBe("acme-main-model");
    expect(card?.getAttribute("data-mini-deployment")).toBe("acme-fast-model");
    expect(card?.getAttribute("data-embedding-deployment")).toBe("acme-search-model");
    // Serialized across the server boundary — a Date would not survive as a prop.
    expect(card?.getAttribute("data-connected-at")).toBe("2026-08-27T12:00:00.000Z");
  });

  it("hands the card the recorded cause when the connection is in error", async () => {
    mockGetConnection.mockResolvedValue(
      azureRow({ status: "error", lastSyncError: "Search model: DeploymentNotFound" }),
    );

    const { container } = await renderPage();
    const card = azureCard(container);

    expect(card?.getAttribute("data-status")).toBe("error");
    // Verbatim. "Search model: DeploymentNotFound" tells an admin where to go;
    // the card's generic "can no longer reach your Azure resource" does not,
    // and flattening this prop to null is what a refactor does to it.
    expect(card?.getAttribute("data-error-detail")).toBe("Search model: DeploymentNotFound");
  });

  it("withholds a STALE cause from a connection that is healthy again", async () => {
    // The branch at page.tsx's `errorDetail` ternary. `setConnectionStatus`
    // clears last_sync_error on a passing re-check, but a row can still carry
    // one from a failure a later re-check cleared by another path — and a red
    // sentence beside a green badge reads as a live problem.
    mockGetConnection.mockResolvedValue(
      azureRow({ status: "connected", lastSyncError: "Search model: DeploymentNotFound" }),
    );

    const { container } = await renderPage();
    const card = azureCard(container);

    expect(card?.getAttribute("data-status")).toBe("connected");
    expect(card?.getAttribute("data-error-detail")).toBe("");
  });

  it("tells the card there is nothing stored when the firm has never connected", async () => {
    const { container } = await renderPage();
    const card = azureCard(container);

    expect(card?.getAttribute("data-status")).toBe("disconnected");
    expect(card?.getAttribute("data-endpoint")).toBe("");
    expect(card?.getAttribute("data-api-version")).toBe("");
    expect(card?.getAttribute("data-chat-deployment")).toBe("");
    expect(card?.getAttribute("data-mini-deployment")).toBe("");
    expect(card?.getAttribute("data-embedding-deployment")).toBe("");
    expect(card?.getAttribute("data-connected-at")).toBe("");
    expect(card?.getAttribute("data-error-detail")).toBe("");
  });

  it("survives a corrupt stored config — the page renders, the config fields are empty", async () => {
    // decodeAzureConfig is the REAL codec here, so this is a genuine throw. An
    // unhandled one takes the page down and leaves the admin no way to
    // reconnect the very thing that is broken.
    mockGetConnection.mockResolvedValue(azureRow({ scope: "{{not json" }));

    const { container } = await renderPage();
    const card = azureCard(container);

    expect(card).toBeTruthy();
    expect(card?.getAttribute("data-endpoint")).toBe("");
    expect(card?.getAttribute("data-api-version")).toBe("");
    expect(card?.getAttribute("data-chat-deployment")).toBe("");
    expect(card?.getAttribute("data-mini-deployment")).toBe("");
    expect(card?.getAttribute("data-embedding-deployment")).toBe("");
    // The status still comes off the ROW, which is readable — only the config
    // is not. Blanking the status too would hide a broken connection entirely.
    expect(card?.getAttribute("data-status")).toBe("connected");
  });

  it("never leaks the stored API key into a rendered prop", async () => {
    // Constraint 7. The key lives in `accessToken`, decrypted by getConnection
    // on the way past, so it is sitting right there on the row this page reads.
    mockGetConnection.mockResolvedValue(
      azureRow({ accessToken: JSON.stringify({ apiKey: "sk-firm-secret" }) }),
    );

    const { container } = await renderPage();

    expect(container.innerHTML).not.toContain("sk-firm-secret");
  });

  it("gives azure_openai no connection list, even fully connected", async () => {
    // `syncs: false` on the provider definition is what keeps it off that path.
    mockGetConnection.mockResolvedValue(azureRow());

    const { container } = await renderPage();

    expect(container.querySelector("[data-testid='connection-list']")).toBeNull();
    expect(azureCard(container)).toBeTruthy();
  });
});

describe("Integration detail — the role gate", () => {
  it("shows the forbidden page instead of Azure's connection state to a member, before any read", async () => {
    mockAuth.mockResolvedValue({ orgId: "org_acme", userId: "user_ana", orgRole: "org:member" });

    const { container } = await renderPage();

    expect(azureCard(container)).toBeNull();
    expect(mockGetConnection).not.toHaveBeenCalled();
    expect(container.textContent ?? "").toContain("Not available for your role");
  });

  it("shows the forbidden page when there is no active organization", async () => {
    mockAuth.mockResolvedValue({ orgId: null, userId: "user_dan", orgRole: null });

    const { container } = await renderPage();

    expect(azureCard(container)).toBeNull();
    expect(mockGetConnection).not.toHaveBeenCalled();
  });
});

describe("Integration detail — Calendar & to-dos (Workspace)", () => {
  beforeEach(() => vi.stubEnv("WORKSPACE_ENABLED", "true"));

  it("404s for everyone with the flag off, before the admin check or any read", async () => {
    vi.stubEnv("WORKSPACE_ENABLED", "false");
    await expect(renderPage("microsoft_365")).rejects.toThrow("NEXT_NOT_FOUND");
    mockAuth.mockResolvedValue({ orgId: "org_acme", userId: "user_ana", orgRole: "org:member" });
    await expect(renderPage("microsoft_365")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mockApproval).not.toHaveBeenCalled();
    expect(mockMembers).not.toHaveBeenCalled();
    expect(mockFirmConnections).not.toHaveBeenCalled();
  });

  it("shows a non-admin the forbidden page without reading anything", async () => {
    mockAuth.mockResolvedValue({ orgId: "org_acme", userId: "user_ana", orgRole: "org:member" });
    const { container } = await renderPage("microsoft_365");
    expect(container.querySelector("[data-testid='ws-card']")).toBeNull();
    expect(container.textContent ?? "").toContain("Not available for your role");
    expect(mockApproval).not.toHaveBeenCalled();
    expect(mockMembers).not.toHaveBeenCalled();
    expect(mockFirmConnections).not.toHaveBeenCalled();
  });

  it("is titled Calendar & to-dos", async () => {
    const { getByRole } = await renderPage("microsoft_365");
    expect(getByRole("heading", { level: 1 }).textContent).toBe("Calendar & to-dos");
  });

  it("gives an admin each member's connected addresses, every provider", async () => {
    mockApproval.mockResolvedValue({
      tenantId: "t",
      approvedScopes: "s",
      approvedAt: new Date("2026-10-28T15:00:00.000Z"),
    });
    mockMembers.mockResolvedValue([
      { userId: "u1", displayName: "Dana" },
      { userId: "u2", displayName: "Marcus" },
      { userId: "u3", displayName: "Sam" },
    ]);
    mockFirmConnections.mockResolvedValue([
      { id: "c1", userId: "u1", provider: "microsoft", email: "dana@h.com", status: "connected", connectedAt: "2026-10-01T00:00:00.000Z" },
      { id: "c2", userId: "u3", provider: "microsoft", email: "sam@h.com", status: "needs_reconnect", connectedAt: "2026-10-02T00:00:00.000Z" },
      { id: "c3", userId: "u1", provider: "google", email: "dana@gmail.com", status: "connected", connectedAt: "2026-10-03T00:00:00.000Z" },
    ]);

    const { container } = await renderPage("microsoft_365", { approved: "1" });
    const card = container.querySelector("[data-testid='ws-card']");

    expect(mockFirmConnections).toHaveBeenCalledWith("org_acme");
    expect(mockApproval).toHaveBeenCalledWith("org_acme", "microsoft");
    expect(card?.getAttribute("data-approved-at")).toBe("2026-10-28T15:00:00.000Z");
    expect(card?.getAttribute("data-flash")).toBe("approved");
    expect(card?.getAttribute("data-members")).toBe(
      "u1=Dana=c1:microsoft:dana@h.com:connected,c3:google:dana@gmail.com:connected" +
        "|u2=Marcus=" +
        "|u3=Sam=c2:microsoft:sam@h.com:needs_reconnect",
    );
  });

  it("maps the error query values to a flash, and anything else to none", async () => {
    const flash = async (sp: Record<string, string>) =>
      (await renderPage("microsoft_365", sp)).container
        .querySelector("[data-testid='ws-card']")
        ?.getAttribute("data-flash");
    expect(await flash({ error: "consent_declined" })).toBe("consent_declined");
    expect(await flash({ error: "consent_expired" })).toBe("consent_expired");
    expect(await flash({ error: "weird" })).toBe("");
    expect(await flash({})).toBe("");
  });
});

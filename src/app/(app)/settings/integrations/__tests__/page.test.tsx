// @vitest-environment jsdom
//
// The Integrations page is a server component that decides, per firm, what the
// Azure OpenAI card is told. Nothing watched that hand-off before: every prop
// below could be blanked — `errorDetail` flattened to `null`, the whole decoded
// config dropped — with the entire scoped suite green. The connected and error
// states are also unreachable in a browser today (no firm can connect while
// AZURE_OPENAI_EMBEDDINGS_DEPLOYMENT is unset), so without this file NOTHING,
// test or human, watches two of the card's three states.
//
// Shape follows the repo's own precedent for a server page:
// src/app/(app)/settings/branding/__tests__/page.test.tsx — replace the child
// with a marker that records exactly what the page decided to pass down.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";

const mockAuth = vi.fn();
const mockRequireAdmin = vi.fn();
const mockGetConnection = vi.fn();
const mockPlaidCounts = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({ auth: () => mockAuth() }));

// ForbiddenError is declared INSIDE the factory rather than imported from the
// real module: the page does `err instanceof ForbiddenError`, and both sides of
// that check resolve through this same mock, so the identity holds. Importing
// the real authz.ts would drag in clerkClient, billing and the DB for a gate
// this file only needs to be able to make refuse.
// `vi.hoisted` because vi.mock's factory is hoisted above every top-level
// binding: a plain `class MockForbiddenError` here is still in its temporal dead
// zone when the factory runs.
const { MockForbiddenError } = vi.hoisted(() => ({
  MockForbiddenError: class MockForbiddenError extends Error {},
}));
vi.mock("@/lib/authz", () => ({
  ForbiddenError: MockForbiddenError,
  requireOrgAdminOrOwner: () => mockRequireAdmin(),
}));

vi.mock("@/lib/integrations/connections", () => ({
  getConnection: (...a: unknown[]) => mockGetConnection(...a),
}));

// The Plaid tile's counts come from one aggregate read that has nothing to do
// with this page's Azure hand-off.
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({ innerJoin: () => ({ where: () => mockPlaidCounts() }) }),
    }),
  },
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
vi.mock("@/components/IntegrationConnectionCard", () => ({
  IntegrationConnectionCard: (p: { providerId: string }) => (
    <div data-testid="sync-card" data-provider={p.providerId} />
  ),
}));
vi.mock("@/components/IntegrationHouseholdLinkTable", () => ({
  IntegrationHouseholdLinkTable: (p: { providerId: string }) => (
    <div data-testid="household-table" data-provider={p.providerId} />
  ),
}));
vi.mock("@/components/PlaidIntegrationTile", () => ({
  PlaidIntegrationTile: () => <div data-testid="plaid-tile" />,
}));

// DELIBERATELY UNMOCKED, and each for a reason a mock would destroy:
//  - "@/lib/integrations/registry" — the real registry is the only thing that
//    proves azure_openai carries `syncs: false`, which is what keeps it out of
//    the sync card + household table loop.
//  - "@/lib/ai/credentials" — decodeAzureConfig is the real codec, so the
//    corrupt-scope case genuinely exercises the page's try/catch instead of a
//    stub that throws on cue.
//  - the azure_openai flag module — the kill-switch reads process.env directly,
//    and stubEnv is a truer test of it than a mocked boolean.
import IntegrationsPage from "../page";

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

/** getConnection answers only for azure_openai; every custodial provider reads
 *  as unconnected unless a test says otherwise. */
function onlyAzure(row: unknown) {
  mockGetConnection.mockImplementation(async (_firmId: string, providerId: string) =>
    providerId === "azure_openai" ? row : null,
  );
}

async function renderPage() {
  return render(await IntegrationsPage());
}

function azureCard(container: HTMLElement) {
  return container.querySelector("[data-testid='azure-card']");
}

beforeEach(() => {
  vi.stubEnv("AZURE_BYOK_ENABLED", "true");
  mockAuth.mockReset().mockResolvedValue({ orgId: "org_acme" });
  mockRequireAdmin.mockReset().mockResolvedValue(undefined);
  mockGetConnection.mockReset().mockResolvedValue(null);
  mockPlaidCounts.mockReset().mockResolvedValue([{ clientCount: 0, institutionCount: 0 }]);
});

afterEach(() => vi.unstubAllEnvs());

describe("IntegrationsPage — the Azure OpenAI kill-switch", () => {
  it("renders no card and reads no connection for azure_openai while the flag is off", async () => {
    vi.stubEnv("AZURE_BYOK_ENABLED", "false");

    const { container } = await renderPage();

    expect(azureCard(container)).toBeNull();
    // Not just "no card": the read itself must not happen. The flag guards a
    // database round trip per page load, and a card rendered from a row that
    // was fetched anyway is a kill-switch that only hides the UI.
    const azureReads = mockGetConnection.mock.calls.filter((c) => c[1] === "azure_openai");
    expect(azureReads).toEqual([]);
    // The rest of the page still renders — the flag scopes to Azure alone.
    expect(container.querySelector("[data-testid='plaid-tile']")).toBeTruthy();
  });

  it("renders the card and reads the connection once the flag is on", async () => {
    onlyAzure(azureRow());

    const { container } = await renderPage();

    expect(azureCard(container)).toBeTruthy();
    expect(mockGetConnection).toHaveBeenCalledWith("org_acme", "azure_openai");
  });
});

describe("IntegrationsPage — what the Azure card is told", () => {
  it("forwards every field of the stored config, not just the endpoint and main model", async () => {
    // The connected card is the artifact a firm shows its auditor, so all five
    // decoded fields have to survive the hand-off. A page that decoded the
    // config and forwarded a two-field slice of it passed every other test.
    onlyAzure(azureRow());

    const { container } = await renderPage();
    const card = azureCard(container);

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
    onlyAzure(
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
    onlyAzure(
      azureRow({ status: "connected", lastSyncError: "Search model: DeploymentNotFound" }),
    );

    const { container } = await renderPage();
    const card = azureCard(container);

    expect(card?.getAttribute("data-status")).toBe("connected");
    expect(card?.getAttribute("data-error-detail")).toBe("");
  });

  it("tells the card there is nothing stored when the firm has never connected", async () => {
    onlyAzure(null);

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
    // unhandled one takes the whole Integrations page down, including Plaid and
    // every custodian, and leaves the admin no way to reconnect the very thing
    // that is broken.
    onlyAzure(azureRow({ scope: "{{not json" }));

    const { container } = await renderPage();
    const card = azureCard(container);

    expect(card).toBeTruthy();
    expect(container.querySelector("[data-testid='plaid-tile']")).toBeTruthy();
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
    onlyAzure(azureRow({ accessToken: JSON.stringify({ apiKey: "sk-firm-secret" }) }));

    const { container } = await renderPage();

    expect(container.innerHTML).not.toContain("sk-firm-secret");
  });
});

describe("IntegrationsPage — azure_openai stays out of the custodial loop", () => {
  it("gives azure_openai no sync card and no household table, even fully connected", async () => {
    // `syncs: false` on the provider definition is what keeps it out. Every
    // provider reads as CONNECTED here on purpose: with the custodians
    // unconnected no household table renders at all, and "no azure table"
    // would then be true of a page that rendered nothing.
    mockGetConnection.mockResolvedValue(azureRow());

    const { container } = await renderPage();
    const syncCards = Array.from(container.querySelectorAll("[data-testid='sync-card']"));
    const tables = Array.from(container.querySelectorAll("[data-testid='household-table']"));

    // The loop really did run and really did render tables...
    expect(syncCards.length).toBeGreaterThan(0);
    expect(tables.length).toBe(syncCards.length);
    // ...and azure_openai is in neither.
    expect(syncCards.map((n) => n.getAttribute("data-provider"))).not.toContain("azure_openai");
    expect(tables.map((n) => n.getAttribute("data-provider"))).not.toContain("azure_openai");
    // It got its own card instead.
    expect(azureCard(container)).toBeTruthy();
  });
});

describe("IntegrationsPage — the role gate", () => {
  it("shows the forbidden page instead of any connection state to a non-admin", async () => {
    mockRequireAdmin.mockRejectedValue(new MockForbiddenError("Organization admin role required"));

    const { container } = await renderPage();

    expect(azureCard(container)).toBeNull();
    // The refusal must land before the reads, not merely hide their output.
    expect(mockGetConnection).not.toHaveBeenCalled();
    expect(container.textContent ?? "").toContain("Not available for your role");
  });

  it("rethrows a failure that is NOT a role refusal rather than rendering forbidden", async () => {
    // Swallowing everything here would turn a database outage into a page that
    // calmly tells an admin they lack a role they have.
    mockRequireAdmin.mockRejectedValue(new Error("connection terminated unexpectedly"));

    await expect(IntegrationsPage()).rejects.toThrow("connection terminated unexpectedly");
  });

  it("shows the forbidden page when there is no active organization", async () => {
    mockAuth.mockResolvedValue({ orgId: null });

    const { container } = await renderPage();

    expect(azureCard(container)).toBeNull();
    expect(mockGetConnection).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
//
// One connection's page: a connection that isn't the caller's is a 404, and
// the connection's id reaches the card, the review panel and the table.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";

const mockAuth = vi.fn();
const mockGetOwned = vi.fn();
const mockListOpenReviews = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({ auth: () => mockAuth() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/integrations/connection-access", () => ({
  getOwnedConnection: (...a: unknown[]) => mockGetOwned(...a),
}));
vi.mock("@/lib/integrations/reviews", () => ({
  listOpenReviews: (...a: unknown[]) => mockListOpenReviews(...a),
}));

vi.mock("@/components/IntegrationConnectionCard", () => ({
  IntegrationConnectionCard: (p: { connectionId: string; name: string; status: string; providerId: string }) => (
    <div
      data-testid="card"
      data-connection-id={p.connectionId}
      data-name={p.name}
      data-status={p.status}
      data-provider={p.providerId}
    />
  ),
}));
vi.mock("@/components/IntegrationHouseholdLinkTable", () => ({
  IntegrationHouseholdLinkTable: (p: { connectionId: string; providerId: string }) => (
    <div data-testid="table" data-connection-id={p.connectionId} data-provider={p.providerId} />
  ),
}));
vi.mock("@/components/IntegrationPendingReviews", () => ({
  IntegrationPendingReviews: (p: { reviews: { importId: string }[] }) => (
    <div data-testid="reviews" data-import-ids={p.reviews.map((r) => r.importId).join(",")} />
  ),
}));

import IntegrationConnectionPage from "../page";

const CONN_ID = "5b7f3c0e-8f1a-4d57-9a55-0a1c2d3e4f50";

function connection(over: Record<string, unknown> = {}) {
  return {
    id: CONN_ID,
    providerId: "addepar",
    name: "Ethos",
    status: "connected",
    lastSyncedAt: new Date("2026-10-01T15:00:00Z"),
    lastSyncError: null,
    ...over,
  };
}

async function renderPage(integration = "addepar", connectionId = CONN_ID) {
  return render(
    await IntegrationConnectionPage({ params: Promise.resolve({ integration, connectionId }) }),
  );
}

beforeEach(() => {
  vi.stubEnv("ADDEPAR_ENABLED", "true");
  mockAuth.mockReset().mockResolvedValue({ orgId: "org_acme", userId: "user_ana", orgRole: "org:member" });
  mockGetOwned.mockReset().mockResolvedValue(connection());
  mockListOpenReviews.mockReset().mockResolvedValue([]);
});

afterEach(() => vi.unstubAllEnvs());

describe("Connection page", () => {
  it("404 for a colleague's connection", async () => {
    mockGetOwned.mockResolvedValue(null);

    await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND");

    expect(mockGetOwned).toHaveBeenCalledWith({
      connectionId: CONN_ID,
      firmId: "org_acme",
      userId: "user_ana",
    });
    expect(mockListOpenReviews).not.toHaveBeenCalled();
  });

  it("404s a connection that belongs to a different provider than the URL says", async () => {
    mockGetOwned.mockResolvedValue(connection({ providerId: "orion" }));

    await expect(renderPage("addepar")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("404s an id that is not a syncing provider", async () => {
    await expect(renderPage("azure_openai")).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(renderPage("plaid")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mockGetOwned).not.toHaveBeenCalled();
  });

  it("passes the connection id to the card, reviews and table", async () => {
    mockListOpenReviews.mockResolvedValue([
      { importId: "imp-1", clientId: "c-1", householdName: "Denise McCormick", accountCount: 9 },
    ]);

    const { container } = await renderPage();

    expect(container.querySelector("[data-testid='card']")?.getAttribute("data-connection-id")).toBe(CONN_ID);
    expect(mockListOpenReviews).toHaveBeenCalledWith(CONN_ID);
    expect(container.querySelector("[data-testid='reviews']")?.getAttribute("data-import-ids")).toBe("imp-1");
    expect(container.querySelector("[data-testid='table']")?.getAttribute("data-connection-id")).toBe(CONN_ID);
  });

  it("titles the page with the connection's name and links back to the provider page", async () => {
    const { getByRole } = await renderPage();

    expect(getByRole("heading", { level: 1 }).textContent).toBe("Ethos");
    expect(getByRole("link", { name: /Addepar/ }).getAttribute("href")).toBe("/settings/integrations/addepar");
  });

  it("falls back to the provider label when the connection has no name", async () => {
    mockGetOwned.mockResolvedValue(connection({ name: null }));

    const { getByRole, container } = await renderPage();

    expect(getByRole("heading", { level: 1 }).textContent).toBe("Addepar");
    expect(container.querySelector("[data-testid='card']")?.getAttribute("data-name")).toBe("Addepar");
  });

  it("keeps the table while a broken connection waits to be reconnected, drops it once disconnected", async () => {
    mockGetOwned.mockResolvedValue(connection({ status: "error", lastSyncError: "401" }));
    expect((await renderPage()).container.querySelector("[data-testid='table']")).toBeTruthy();

    mockGetOwned.mockResolvedValue(connection({ status: "disconnected" }));
    const { container } = await renderPage();

    expect(container.querySelector("[data-testid='table']")).toBeNull();
    expect(container.querySelector("[data-testid='card']")?.getAttribute("data-status")).toBe("disconnected");
    expect(mockListOpenReviews).toHaveBeenCalledTimes(1);
  });

  it("shows the forbidden page with no active organization, before any read", async () => {
    mockAuth.mockResolvedValue({ orgId: null, userId: "user_ana", orgRole: null });

    const { container } = await renderPage();

    expect(container.textContent ?? "").toContain("Not available for your role");
    expect(mockGetOwned).not.toHaveBeenCalled();
  });
});

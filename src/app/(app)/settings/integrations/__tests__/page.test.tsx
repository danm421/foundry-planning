// @vitest-environment jsdom
//
// The Integrations list: what is in use sorts to the top, and each row opens
// that integration's own page. The registry and the provider flags are real —
// the flags read process.env, and stubEnv is a truer test of them than a
// mocked boolean.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, within } from "@testing-library/react";

const mockAuth = vi.fn();
const mockRequireAdmin = vi.fn();
const mockGetConnection = vi.fn();
const mockPlaidUsage = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({ auth: () => mockAuth() }));

// See [integration]/__tests__/page.test.tsx for why the error class lives
// inside a hoisted factory.
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

vi.mock("@/lib/integrations/plaid-usage", () => ({
  getPlaidUsage: (...a: unknown[]) => mockPlaidUsage(...a),
}));

import IntegrationsPage from "../page";

/** getConnection answers per provider id; anything not listed reads as never connected. */
function connections(byProvider: Record<string, unknown>) {
  mockGetConnection.mockImplementation(
    async (_firmId: string, providerId: string) => byProvider[providerId] ?? null,
  );
}

async function renderPage() {
  return render(await IntegrationsPage());
}

/** Each visible group's title and the integration names in it, in order. */
function groups(container: HTMLElement) {
  return Array.from(container.querySelectorAll("section")).map((s) => ({
    title: s.querySelector("h2")?.textContent,
    names: Array.from(s.querySelectorAll("li")).map(
      (li) => li.querySelector(".font-medium")?.textContent,
    ),
  }));
}

beforeEach(() => {
  vi.stubEnv("AZURE_BYOK_ENABLED", "true");
  vi.stubEnv("ADDEPAR_ENABLED", "true");
  vi.stubEnv("ORION_ENABLED", "false");
  vi.stubEnv("SCHWAB_ENABLED", "false");
  mockAuth.mockReset().mockResolvedValue({ orgId: "org_acme" });
  mockRequireAdmin.mockReset().mockResolvedValue(undefined);
  mockGetConnection.mockReset().mockResolvedValue(null);
  mockPlaidUsage.mockReset().mockResolvedValue({ clientCount: 0, institutionCount: 0 });
});

afterEach(() => vi.unstubAllEnvs());

describe("IntegrationsPage — order", () => {
  it("puts what the firm uses first, a broken connection above a healthy one", async () => {
    connections({
      addepar: { status: "connected", lastSyncedAt: new Date("2026-10-01T15:00:00Z") },
      azure_openai: { status: "error" },
    });
    mockPlaidUsage.mockResolvedValue({ clientCount: 3, institutionCount: 4 });

    const { container } = await renderPage();

    expect(groups(container)).toEqual([
      { title: "In use", names: ["Azure OpenAI", "Addepar", "Plaid"] },
      { title: "Coming soon", names: ["Orion Advisor Tech", "Schwab Advisor Services"] },
    ]);
  });

  it("lists everything under Available when nothing is connected yet — no empty In use group", async () => {
    const { container } = await renderPage();

    expect(groups(container)).toEqual([
      { title: "Available", names: ["Addepar", "Azure OpenAI", "Plaid"] },
      { title: "Coming soon", names: ["Orion Advisor Tech", "Schwab Advisor Services"] },
    ]);
  });

  it("states each in-use row's status in words, not only as a coloured dot", async () => {
    connections({
      addepar: { status: "connected", lastSyncedAt: new Date("2026-10-01T15:00:00Z") },
      azure_openai: { status: "error" },
    });
    mockPlaidUsage.mockResolvedValue({ clientCount: 3, institutionCount: 4 });

    const { getByRole } = await renderPage();

    const addepar = getByRole("link", { name: /Addepar/ });
    expect(within(addepar).getByText("Connected")).toBeTruthy();
    expect(addepar.textContent).toContain("Last synced");
    expect(addepar.textContent).toContain("Oct 1, 2026");
    expect(within(getByRole("link", { name: /Azure OpenAI/ })).getByText("Reconnect needed")).toBeTruthy();
    expect(getByRole("link", { name: /Plaid/ }).textContent).toContain("Clients linked 3");
  });
});

describe("IntegrationsPage — rows open their own page", () => {
  it("links every live integration to its detail page", async () => {
    const { getByRole } = await renderPage();

    expect(getByRole("link", { name: /Addepar/ }).getAttribute("href")).toBe(
      "/settings/integrations/addepar",
    );
    expect(getByRole("link", { name: /Azure OpenAI/ }).getAttribute("href")).toBe(
      "/settings/integrations/azure_openai",
    );
    expect(getByRole("link", { name: /Plaid/ }).getAttribute("href")).toBe(
      "/settings/integrations/plaid",
    );
  });

  it("gives a coming-soon integration no link — its page would have nothing on it", async () => {
    const { queryByRole, getByText } = await renderPage();

    expect(queryByRole("link", { name: /Orion/ })).toBeNull();
    expect(getByText("Orion Advisor Tech")).toBeTruthy();
  });
});

describe("IntegrationsPage — the Azure OpenAI kill-switch", () => {
  it("shows no Azure row and reads no Azure connection while the flag is off", async () => {
    vi.stubEnv("AZURE_BYOK_ENABLED", "false");

    const { container } = await renderPage();

    expect(container.textContent).not.toContain("Azure OpenAI");
    const azureReads = mockGetConnection.mock.calls.filter((c) => c[1] === "azure_openai");
    expect(azureReads).toEqual([]);
  });
});

describe("IntegrationsPage — the role gate", () => {
  it("shows the forbidden page, before any read, to a non-admin", async () => {
    mockRequireAdmin.mockRejectedValue(new MockForbiddenError("Organization admin role required"));

    const { container } = await renderPage();

    expect(container.textContent ?? "").toContain("Not available for your role");
    expect(mockGetConnection).not.toHaveBeenCalled();
    expect(mockPlaidUsage).not.toHaveBeenCalled();
  });

  it("rethrows a failure that is NOT a role refusal", async () => {
    mockRequireAdmin.mockRejectedValue(new Error("connection terminated unexpectedly"));

    await expect(IntegrationsPage()).rejects.toThrow("connection terminated unexpectedly");
  });

  it("shows the forbidden page when there is no active organization", async () => {
    mockAuth.mockResolvedValue({ orgId: null });

    const { container } = await renderPage();

    expect(container.textContent ?? "").toContain("Not available for your role");
    expect(mockGetConnection).not.toHaveBeenCalled();
  });
});

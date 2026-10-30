// @vitest-environment jsdom
//
// The Integrations list: what is in use sorts to the top, and each row opens
// that integration's own page. The registry and the provider flags are real —
// the flags read process.env, and stubEnv is a truer test of them than a
// mocked boolean.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, within } from "@testing-library/react";

const mockAuth = vi.fn();
const mockGetConnection = vi.fn();
const mockListOwned = vi.fn();
const mockPlaidUsage = vi.fn();
const mockFirmConnections = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({ auth: () => mockAuth() }));

vi.mock("@/lib/integrations/connections", () => ({
  getConnection: (...a: unknown[]) => mockGetConnection(...a),
  listOwnedConnections: (...a: unknown[]) => mockListOwned(...a),
}));

vi.mock("@/lib/integrations/plaid-usage", () => ({
  getPlaidUsage: (...a: unknown[]) => mockPlaidUsage(...a),
}));

vi.mock("@/lib/workspace/connections", () => ({
  listFirmConnections: (...a: unknown[]) => mockFirmConnections(...a),
}));

import IntegrationsPage from "../page";

/** getConnection (Azure only) answers per provider id; anything not listed reads as never connected. */
function connections(byProvider: Record<string, unknown>) {
  mockGetConnection.mockImplementation(
    async (_firmId: string, providerId: string) => byProvider[providerId] ?? null,
  );
}

/** The caller's own syncing connections. */
function owned(...rows: Array<Record<string, unknown>>) {
  mockListOwned.mockResolvedValue(
    rows.map((r, i) => ({
      id: `conn-${i}`,
      providerId: "addepar",
      name: "Ethos",
      status: "connected",
      lastSyncedAt: null,
      lastSyncError: null,
      linkedHouseholds: 0,
      ...r,
    })),
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
  mockAuth
    .mockReset()
    .mockResolvedValue({ orgId: "org_acme", userId: "user_dan", orgRole: "org:admin" });
  mockGetConnection.mockReset().mockResolvedValue(null);
  mockListOwned.mockReset().mockResolvedValue([]);
  mockPlaidUsage.mockReset().mockResolvedValue({ clientCount: 0, institutionCount: 0 });
  mockFirmConnections.mockReset().mockResolvedValue([]);
});

afterEach(() => vi.unstubAllEnvs());

describe("IntegrationsPage — order", () => {
  it("puts what the firm uses first, a broken connection above a healthy one", async () => {
    connections({ azure_openai: { status: "error" } });
    owned({ lastSyncedAt: new Date("2026-10-01T15:00:00Z") });
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
    connections({ azure_openai: { status: "error" } });
    owned({ lastSyncedAt: new Date("2026-10-01T15:00:00Z") });
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

describe("IntegrationsPage — a firm member", () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue({ orgId: "org_acme", userId: "user_ana", orgRole: "org:member" });
  });

  it("a member sees only their own Addepar connections", async () => {
    owned({ name: "Ethos" });

    const { getByRole } = await renderPage();

    expect(mockListOwned).toHaveBeenCalledWith({ firmId: "org_acme", userId: "user_ana" });
    expect(within(getByRole("link", { name: /Addepar/ })).getByText("Connected")).toBeTruthy();
  });

  it("a member never sees the Azure row and Azure's connection is never read", async () => {
    const { container } = await renderPage();

    expect(container.textContent).not.toContain("Azure OpenAI");
    expect(mockGetConnection).not.toHaveBeenCalled();
  });

  it("a member never sees Plaid and Plaid usage is never read", async () => {
    const { container } = await renderPage();

    expect(container.textContent).not.toContain("Plaid");
    expect(mockPlaidUsage).not.toHaveBeenCalled();
  });
});

describe("IntegrationsPage — several connections", () => {
  it("Addepar with two connections reads '2 connections'", async () => {
    owned({ name: "Ethos" }, { name: "Other", status: "disconnected" });

    const { getByRole } = await renderPage();

    expect(getByRole("link", { name: /Addepar/ }).textContent).toContain("2 connections");
  });

  it("one broken connection among healthy ones reads 'Reconnect needed'", async () => {
    owned({ name: "Ethos" }, { name: "Other", status: "error" });

    const { getByRole } = await renderPage();

    expect(within(getByRole("link", { name: /Addepar/ })).getByText("Reconnect needed")).toBeTruthy();
  });
});

describe("IntegrationsPage — signed-out or org-less", () => {
  it("shows the forbidden page, before any read, when there is no active organization", async () => {
    mockAuth.mockResolvedValue({ orgId: null, userId: "user_dan", orgRole: null });

    const { container } = await renderPage();

    expect(container.textContent ?? "").toContain("Not available for your role");
    expect(mockGetConnection).not.toHaveBeenCalled();
    expect(mockListOwned).not.toHaveBeenCalled();
    expect(mockPlaidUsage).not.toHaveBeenCalled();
  });
});

describe("IntegrationsPage — Calendar & to-dos (Workspace)", () => {
  beforeEach(() => vi.stubEnv("WORKSPACE_ENABLED", "true"));

  /** One connected address as listFirmConnections returns it. */
  const address = (userId: string, provider: string, status: string) => ({
    id: `${userId}-${provider}`,
    userId,
    provider,
    email: `${userId}@x.com`,
    status,
    connectedAt: "2026-10-01T00:00:00.000Z",
  });

  it("an admin sees it under Workspace, named Calendar & to-dos, until someone connects", async () => {
    const { getByRole } = await renderPage();

    const row = getByRole("link", { name: /Calendar & to-dos/ });
    expect(row.getAttribute("href")).toBe("/settings/integrations/microsoft_365");
    expect(within(row).getByText("Workspace")).toBeTruthy();
    expect(
      within(row).getByText("Your advisors' Google and Outlook calendars and to-do lists, in Workspace."),
    ).toBeTruthy();
    expect(within(row).getByText("Not connected")).toBeTruthy();
    expect(mockFirmConnections).toHaveBeenCalledWith("org_acme");
  });

  it("is in use once anyone has connected an address, counting advisors with a working one", async () => {
    mockFirmConnections.mockResolvedValue([
      address("u1", "microsoft", "connected"),
      address("u1", "google", "connected"),
      address("u2", "google", "needs_reconnect"),
    ]);

    const { getByRole } = await renderPage();

    const row = getByRole("link", { name: /Calendar & to-dos/ });
    expect(within(row).getByText("Connected")).toBeTruthy();
    expect(row.textContent).toContain("Advisors connected 1");
  });

  it("a member never sees it and no connection is read", async () => {
    mockAuth.mockResolvedValue({ orgId: "org_acme", userId: "user_ana", orgRole: "org:member" });

    const { container } = await renderPage();

    expect(container.textContent).not.toContain("Calendar & to-dos");
    expect(mockFirmConnections).not.toHaveBeenCalled();
  });
});

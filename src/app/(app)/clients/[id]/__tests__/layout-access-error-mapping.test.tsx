// @vitest-environment jsdom
//
// ClientLayout — which failures may become notFound().
//
// Same contract as the API route (see
// src/app/api/clients/[id]/__tests__/get-access-error-mapping.test.ts):
// UnauthorizedError / ForbiddenError render as not-found (merging the two is
// deliberate — client existence must not leak across firms), and every other
// failure propagates so an outage shows up as a 500 instead of masquerading as
// a missing client.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ForbiddenError } from "@/lib/authz";
import { UnauthorizedError } from "@/lib/db-helpers";

vi.mock("@/lib/clients/authz", () => ({ requireClientAccess: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(() => Promise.resolve({ orgRole: "org:admin" })),
}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

// The layout throws at the access gate before touching any of these; they are
// stubbed only so the module graph resolves under vitest.
vi.mock("@/db", () => ({ db: { select: vi.fn() } }));
vi.mock("@/db/schema", () => ({
  crmHouseholds: {},
  crmHouseholdContacts: {},
  scenarios: {},
  accounts: {},
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  desc: vi.fn(),
  asc: vi.fn(),
  and: vi.fn(),
  isNotNull: vi.fn(),
}));
vi.mock("@/lib/integrations/households", () => ({ getHouseholdLinkForClient: vi.fn() }));
vi.mock("@/lib/integrations/registry", () => ({ getProvider: vi.fn() }));
vi.mock("@/domain/forge/flag", () => ({ isForgeEnabled: () => false }));
vi.mock("@/components/client-header", () => ({ default: () => null }));
vi.mock("@/components/header-subtabs", () => ({ default: () => null }));
vi.mock("@/components/report-section-label", () => ({ default: () => null }));
vi.mock("@/components/crm-household-link", () => ({ default: () => null }));
vi.mock("@/components/client-access-provider", () => ({ ClientAccessProvider: () => null }));
vi.mock("@/components/IntegrationClientStatus", () => ({ IntegrationClientStatus: () => null }));
vi.mock("@/components/scenario/scenario-mode-wrapper", () => ({ ScenarioModeWrapper: () => null }));
vi.mock("@/components/scenario/scenario-chip-row", () => ({ ScenarioChipRow: () => null }));
vi.mock("@/components/scenario/scenario-mode-banner", () => ({ ScenarioModeBanner: () => null }));
vi.mock("@/components/scenario/scenario-drawer-provider", () => ({
  ScenarioDrawerProvider: () => null,
}));
vi.mock("@/components/forge/forge-mount", () => ({ ForgeMount: () => null }));

import ClientLayout from "../layout";
import { notFound } from "next/navigation";
import { requireClientAccess } from "@/lib/clients/authz";

const renderLayout = () =>
  ClientLayout({ children: null, params: Promise.resolve({ id: "c1" }) });

describe("ClientLayout — access error mapping", () => {
  beforeEach(() => {
    vi.mocked(requireClientAccess).mockReset();
    vi.mocked(notFound).mockClear();
  });

  it("renders not-found on ForbiddenError (existence must not leak)", async () => {
    vi.mocked(requireClientAccess).mockRejectedValue(
      new ForbiddenError("Client not found or access denied"),
    );

    await expect(renderLayout()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });

  it("renders not-found on UnauthorizedError (unchanged from before the narrowing)", async () => {
    vi.mocked(requireClientAccess).mockRejectedValue(new UnauthorizedError());

    await expect(renderLayout()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });

  it("propagates a DB fault instead of rendering not-found", async () => {
    const dbFault = Object.assign(
      new Error("column clients.covered_by_workplace_plan does not exist"),
      { code: "42703" },
    );
    vi.mocked(requireClientAccess).mockRejectedValue(dbFault);

    // `rejects.toBe` pins the identity of the thrown value — the layout can
    // only fail this exact way by rethrowing what the gate raised.
    await expect(renderLayout()).rejects.toBe(dbFault);
    expect(notFound).not.toHaveBeenCalled();
  });

  it("propagates a dropped connection instead of rendering not-found", async () => {
    const connFault = new Error("Connection terminated unexpectedly");
    vi.mocked(requireClientAccess).mockRejectedValue(connFault);

    await expect(renderLayout()).rejects.toBe(connFault);
    expect(notFound).not.toHaveBeenCalled();
  });
});

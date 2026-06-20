// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/db/schema", () => ({
  plaidItems: { id: {}, clientId: {}, institutionName: {}, lastRefreshedAt: {}, lastRefreshError: {}, createdAt: {} },
}));

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () =>
            Promise.resolve([
              {
                id: "item-1",
                institutionName: "Chase",
                lastRefreshedAt: new Date(Date.now() - 2 * 3600_000),
                lastRefreshError: null,
              },
              {
                id: "item-2",
                institutionName: "Fidelity",
                lastRefreshedAt: null,
                lastRefreshError: "ITEM_LOGIN_REQUIRED",
              },
            ]),
        }),
      }),
    }),
  },
}));

vi.mock("drizzle-orm", () => ({ eq: () => ({}), inArray: () => ({}) }));

// Mock the client component so we don't need to set up usePlaidLink / router
vi.mock("../institution-row", () => ({
  InstitutionRow: ({
    institutionName,
    statusLabel,
  }: {
    institutionName: string;
    statusLabel: string;
    itemId: string;
    needsReauth: boolean;
    editEnabled: boolean;
  }) => (
    <li>
      <span>{institutionName}</span>
      <span>{statusLabel}</span>
    </li>
  ),
}));

describe("InstitutionsSection", () => {
  it("renders one row per plaid item with appropriate status", async () => {
    const { InstitutionsSection } = await import("../institutions-section");
    render(await InstitutionsSection({ clientId: "client-1", editEnabled: true }));
    expect(screen.getByText("Chase")).toBeInTheDocument();
    expect(screen.getByText(/Last refreshed 2h ago|Last refreshed (less than an|about 2) hour/i)).toBeInTheDocument();
    expect(screen.getByText("Fidelity")).toBeInTheDocument();
    expect(screen.getByText(/Re-auth required/i)).toBeInTheDocument();
  });
});

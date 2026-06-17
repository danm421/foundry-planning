// @vitest-environment jsdom
/**
 * Tests for the "Shared with me" view.
 *
 * The full ClientsContent async server component chains auth(), DB queries,
 * Clerk org lookups, and the shared-access resolver in a single async call —
 * testing it as a mounted component requires an environment that can await
 * async RSC nodes (React 19 experimental tester APIs) which aren't stable in
 * vitest/jsdom yet. Per the task brief, we fall back to:
 *   1. A pure unit test of `buildSharedRows` (the helper that assembles rows
 *      from mocked upstream data) — validates the core logic.
 *   2. A render test of <SharedWithMeTable> — validates the UI contract:
 *      links to /clients/<id>/overview, "Shared by {name} · {firm}" badge,
 *      permission chip, empty state.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ShareDetail } from "@/lib/clients/shared-access";

// ── 1. Unit test: row-building helper ───────────────────────────────────────

// We import the helper directly (not the server component). The helper lives
// in clients-content.tsx but is exported for testability.
import { buildSharedRows, type SharedRow } from "@/app/(app)/clients/clients-content";

const SHARED_CLIENT_ID = "client-uuid-abc";
const OWNER_USER_ID = "user_owner_1";
const FIRM_ID = "org_firm_1";

const SHARE_DETAIL: ShareDetail = {
  clientId: SHARED_CLIENT_ID,
  ownerUserId: OWNER_USER_ID,
  firmId: FIRM_ID,
  permission: "view",
  scope: "client",
};

describe("buildSharedRows", () => {
  it("maps a ShareDetail to a SharedRow with resolved names", () => {
    const ownerNames = new Map([[OWNER_USER_ID, "Alice Owner"]]);
    const firmNames = new Map([[FIRM_ID, "Acme Wealth"]]);
    const clientMeta = new Map([
      [SHARED_CLIENT_ID, { householdName: "Smith HH", primaryName: "John Smith" }],
    ]);

    const rows = buildSharedRows([SHARE_DETAIL], ownerNames, firmNames, clientMeta);

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.clientId).toBe(SHARED_CLIENT_ID);
    expect(row.displayName).toBe("John Smith");
    expect(row.ownerName).toBe("Alice Owner");
    expect(row.firmName).toBe("Acme Wealth");
    expect(row.permission).toBe("view");
  });

  it("falls back to household name when primary contact is absent", () => {
    const ownerNames = new Map([[OWNER_USER_ID, "Alice Owner"]]);
    const firmNames = new Map([[FIRM_ID, "Acme Wealth"]]);
    const clientMeta = new Map([
      [SHARED_CLIENT_ID, { householdName: "Smith HH", primaryName: null }],
    ]);

    const rows = buildSharedRows([SHARE_DETAIL], ownerNames, firmNames, clientMeta);
    expect(rows[0].displayName).toBe("Smith HH");
  });

  it("falls back to 'Unknown user' and 'Unknown firm' when lookups miss", () => {
    const rows = buildSharedRows(
      [SHARE_DETAIL],
      new Map(),
      new Map(),
      new Map([[SHARED_CLIENT_ID, { householdName: "X HH", primaryName: null }]]),
    );
    expect(rows[0].ownerName).toBe("Unknown user");
    expect(rows[0].firmName).toBe("Unknown firm");
  });

  it("returns empty array for empty input", () => {
    expect(buildSharedRows([], new Map(), new Map(), new Map())).toEqual([]);
  });
});

// ── 2. Render test: <SharedWithMeTable> ─────────────────────────────────────

import { SharedWithMeTable } from "@/components/sharing/shared-with-me-table";

const SAMPLE_ROWS: SharedRow[] = [
  {
    clientId: SHARED_CLIENT_ID,
    displayName: "John Smith",
    ownerName: "Alice Owner",
    firmName: "Acme Wealth",
    permission: "view",
  },
];

describe("SharedWithMeTable", () => {
  it("renders a row linking to /clients/<id>/overview", () => {
    render(<SharedWithMeTable rows={SAMPLE_ROWS} />);
    const link = screen.getByRole("link", { name: /John Smith/i });
    expect(link).toBeDefined();
    expect(link.getAttribute("href")).toBe(`/clients/${SHARED_CLIENT_ID}/overview`);
  });

  it("renders the 'Shared by {name} · {firm}' badge", () => {
    const { container } = render(<SharedWithMeTable rows={SAMPLE_ROWS} />);
    // Badge text is split across inner spans. Use data-testid to find the badge
    // span and then assert its full textContent contains the expected pieces.
    const badge = container.querySelector("[data-testid='sharer-badge']");
    expect(badge).not.toBeNull();
    const text = badge?.textContent ?? "";
    expect(text).toContain("Shared by");
    expect(text).toContain("Alice Owner");
    expect(text).toContain("Acme Wealth");
  });

  it("renders a 'View' permission chip for view permission", () => {
    render(<SharedWithMeTable rows={SAMPLE_ROWS} />);
    expect(screen.getByText("View")).toBeDefined();
  });

  it("renders a 'Can edit' chip for edit permission", () => {
    render(
      <SharedWithMeTable
        rows={[{ ...SAMPLE_ROWS[0], permission: "edit" }]}
      />,
    );
    expect(screen.getByText("Can edit")).toBeDefined();
  });

  it("renders the empty state when rows is empty", () => {
    render(<SharedWithMeTable rows={[]} />);
    expect(
      screen.getByText(/Nothing has been shared with you yet/i),
    ).toBeDefined();
  });
});

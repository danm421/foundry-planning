/**
 * `getCrmHousehold` is firm-scoped only. Every document endpoint is gated by
 * `requireVaultAccess`, which is narrower — advisor-of-record, an explicit
 * share, or admin. Eager-loading the `documents` relation here handed a member
 * who is refused on /documents the entire vault index anyway: filenames,
 * descriptions, mime types, sizes and storage keys.
 *
 * The relation must stay out of this query. The vault tab loads its own list
 * through the gated endpoint.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const findFirst = vi.fn();

vi.mock("@/db", () => ({
  db: {
    query: { crmHouseholds: { findFirst: (...a: unknown[]) => findFirst(...a) } },
  },
}));
vi.mock("@/lib/db-helpers", () => ({ requireOrgId: vi.fn().mockResolvedValue("firm-1") }));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn().mockResolvedValue({ userId: "u1" }) }));

import { getCrmHousehold } from "../households";

beforeEach(() => {
  vi.clearAllMocks();
  findFirst.mockResolvedValue(undefined);
});

describe("getCrmHousehold", () => {
  it("does not eager-load the household's vault documents", async () => {
    await getCrmHousehold("household-1");

    expect(findFirst).toHaveBeenCalledTimes(1);
    const args = findFirst.mock.calls[0][0] as { with: Record<string, unknown> };
    expect(Object.keys(args.with)).not.toContain("documents");
  });

  it("still loads the relations the detail page actually renders", async () => {
    await getCrmHousehold("household-1");

    const args = findFirst.mock.calls[0][0] as { with: Record<string, unknown> };
    expect(Object.keys(args.with)).toEqual(
      expect.arrayContaining(["contacts", "planningClient"]),
    );
  });
});

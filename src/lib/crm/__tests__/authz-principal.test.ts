import { describe, it, expect, vi, beforeEach } from "vitest";

const { findFirst, callerMaySeeAdvisor, resolveSharedClientAccess } = vi.hoisted(() => ({
  findFirst: vi.fn(),
  callerMaySeeAdvisor: vi.fn(),
  resolveSharedClientAccess: vi.fn(),
}));

vi.mock("@/db", () => ({ db: { query: { crmHouseholds: { findFirst } } } }));
// `importOriginal` so the day `crm/authz.ts` takes a SECOND runtime binding
// from this module, it resolves instead of every test here dying with an
// opaque "undefined is not a function". The real module is safe to load: it is
// already in this file's graph via `../authz`, and its `@/db` import is mocked
// above.
vi.mock("@/lib/clients/authz", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/clients/authz")>()),
  callerMaySeeAdvisor,
}));
// Doubled purely so the no-sharing rule below reds by ASSERTION. Left
// unmocked, re-adding the fall-through fails with "db.select is not a
// function" — an accident of an incomplete `@/db` double, which evaporates the
// moment anyone adds `select` to it.
vi.mock("@/lib/clients/shared-access", () => ({ resolveSharedClientAccess }));

import { verifyCrmHouseholdAccessFor } from "../authz";
import type { Principal } from "@/lib/clients/authz";

const p: Principal = { userId: "user_1", orgId: "org_1", orgRole: "org:member" } as Principal;

beforeEach(() => {
  findFirst.mockReset();
  callerMaySeeAdvisor.mockReset();
  // A shape the forbidden fall-through could consume, so re-adding it reaches
  // the assertion instead of throwing on an undefined return.
  resolveSharedClientAccess
    .mockReset()
    .mockResolvedValue({ sharedClientIds: new Set<string>(), permissionByClientId: new Map() });
});

describe("verifyCrmHouseholdAccessFor", () => {
  it("allows a visible household in the caller's firm", async () => {
    findFirst.mockResolvedValue({ id: "hh1", firmId: "org_1", advisorId: "user_1", deletedAt: null });
    callerMaySeeAdvisor.mockResolvedValue(true);
    await expect(verifyCrmHouseholdAccessFor(p, "hh1")).resolves.toEqual({
      ok: true, firmId: "org_1", advisorId: "user_1",
    });
  });

  // The spec's sharpest constraint, asserted rather than assumed: a client
  // shared from another firm has a readable PLAN and unreadable NOTES, so this
  // check must NOT mirror `verifyClientAccessFor`'s fall-through to share
  // resolution. Re-adding that fall-through reds here by assertion.
  it("denies a household in another firm without consulting share resolution", async () => {
    findFirst.mockResolvedValue({ id: "hh1", firmId: "org_OTHER", advisorId: "user_1", deletedAt: null });
    callerMaySeeAdvisor.mockResolvedValue(true);
    await expect(verifyCrmHouseholdAccessFor(p, "hh1")).resolves.toEqual({ ok: false });
    expect(resolveSharedClientAccess).not.toHaveBeenCalled();
  });

  it("denies a colleague's household the caller cannot see, without consulting share resolution", async () => {
    // The case requireCrmHouseholdAccess would have ALLOWED — it is firm-wide.
    // The second place a share fall-through could plausibly be re-added, so it
    // carries the same assertion as the cross-firm case above.
    findFirst.mockResolvedValue({ id: "hh1", firmId: "org_1", advisorId: "user_2", deletedAt: null });
    callerMaySeeAdvisor.mockResolvedValue(false);
    await expect(verifyCrmHouseholdAccessFor(p, "hh1")).resolves.toEqual({ ok: false });
    expect(resolveSharedClientAccess).not.toHaveBeenCalled();
  });

  it("denies a household in the Trash", async () => {
    findFirst.mockResolvedValue({
      id: "hh1", firmId: "org_1", advisorId: "user_1", deletedAt: new Date("2026-09-01"),
    });
    callerMaySeeAdvisor.mockResolvedValue(true);
    await expect(verifyCrmHouseholdAccessFor(p, "hh1")).resolves.toEqual({ ok: false });
  });

  it("denies a household that does not exist", async () => {
    findFirst.mockResolvedValue(undefined);
    await expect(verifyCrmHouseholdAccessFor(p, "nope")).resolves.toEqual({ ok: false });
    expect(callerMaySeeAdvisor).not.toHaveBeenCalled();
  });
});

/**
 * Uploading or deleting a vault document writes a household activity row whose
 * title names the file ("Uploaded document: <name>", "Deleted document: <name>").
 * Those rows are vault data: the household Activity and Notes feeds may return
 * them only to a caller who passes `requireVaultAccess`. Anyone else who can
 * open the household gets the feed without them.
 *
 * The real gates run here (`requireCrmHouseholdAccess`, `requireVaultAccess`)
 * over a mocked database; the assertions read the WHERE clause each feed sends,
 * since the filtering happens in the query so paging stays correct.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const { householdFindFirst, activityFindMany, notesWhere } = vi.hoisted(() => ({
  householdFindFirst: vi.fn(),
  activityFindMany: vi.fn(),
  notesWhere: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    query: {
      crmHouseholds: { findFirst: (...a: unknown[]) => householdFindFirst(...a) },
      crmActivity: { findMany: (...a: unknown[]) => activityFindMany(...a) },
    },
    // listHouseholdNotes: select().from().where().orderBy()
    select: () => ({
      from: () => ({
        where: (w: unknown) => {
          notesWhere(w);
          return { orderBy: () => Promise.resolve([]) };
        },
      }),
    }),
  },
}));
vi.mock("@/lib/db-helpers", async (orig) => ({
  ...(await orig<typeof import("@/lib/db-helpers")>()),
  requireOrgId: vi.fn().mockResolvedValue("org_1"),
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
// A firm without book silo: every member can open every household.
vi.mock("@/lib/visibility", async (orig) => {
  const actual = await orig<typeof import("@/lib/visibility")>();
  return { ...actual, resolveVisibleAdvisorIds: vi.fn().mockResolvedValue(actual.VISIBLE_ALL) };
});
vi.mock("@/lib/activity/resolve-actors", () => ({
  hydrateRowActors: async (rows: unknown[]) => rows,
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

import { auth } from "@clerk/nextjs/server";
import { GET as getActivity } from "@/app/api/crm/households/[id]/activity/route";
import { GET as getNotes } from "@/app/api/crm/households/[id]/notes/route";
import { canReadVault } from "../authz";

const HH = "hh-1";
const ctx = { params: Promise.resolve({ id: HH }) };

function signIn(userId: string, orgRole: string) {
  vi.mocked(auth).mockResolvedValue({ userId, orgId: "org_1", orgRole } as never);
}

/** Whether a WHERE clause drops the rows that narrate vault documents. */
function dropsVaultRows(where: unknown): boolean {
  const { sql, params } = new PgDialect().sqlToQuery(where as SQL);
  const text = sql + JSON.stringify(params);
  return text.includes("document_uploaded") && text.includes("documentId");
}

beforeEach(() => {
  vi.clearAllMocks();
  householdFindFirst.mockResolvedValue({
    id: HH,
    firmId: "org_1",
    advisorId: "user_advisor",
    planningClient: null,
  });
  activityFindMany.mockResolvedValue([]);
});

describe("household activity feed", () => {
  it("leaves out document rows for a member the vault refuses", async () => {
    signIn("user_other", "org:member");

    const res = await getActivity(
      new NextRequest(`http://localhost/api/crm/households/${HH}/activity?limit=20&offset=40`),
      ctx,
    );

    expect(res.status).toBe(200);
    const { where, limit, offset } = activityFindMany.mock.calls[0][0];
    expect(dropsVaultRows(where)).toBe(true);
    expect({ limit, offset }).toEqual({ limit: 20, offset: 40 });
  });

  it("keeps document rows for the household's advisor", async () => {
    signIn("user_advisor", "org:member");

    const res = await getActivity(
      new NextRequest(`http://localhost/api/crm/households/${HH}/activity`),
      ctx,
    );

    expect(res.status).toBe(200);
    expect(dropsVaultRows(activityFindMany.mock.calls[0][0].where)).toBe(false);
  });
});

describe("household notes feed", () => {
  it("leaves out document-deletion notes for a member the vault refuses", async () => {
    signIn("user_other", "org:member");

    const res = await getNotes(new NextRequest(`http://localhost/api/crm/households/${HH}/notes`), ctx);

    expect(res.status).toBe(200);
    expect(dropsVaultRows(notesWhere.mock.calls[0][0])).toBe(true);
  });

  it("keeps document-deletion notes for a firm admin", async () => {
    signIn("user_admin", "org:admin");

    const res = await getNotes(new NextRequest(`http://localhost/api/crm/households/${HH}/notes`), ctx);

    expect(res.status).toBe(200);
    expect(dropsVaultRows(notesWhere.mock.calls[0][0])).toBe(false);
  });
});

describe("canReadVault", () => {
  it("passes through a failure that is not a vault refusal", async () => {
    signIn("user_other", "org:member");
    householdFindFirst.mockRejectedValue(new Error("connection reset"));

    await expect(canReadVault(HH)).rejects.toThrow("connection reset");
  });
});

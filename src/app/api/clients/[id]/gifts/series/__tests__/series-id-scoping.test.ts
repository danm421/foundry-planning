/**
 * PATCH / DELETE /api/clients/[id]/gifts/series/[seriesId] — partition scoping.
 *
 * `gift_series` carries a real `scenario_id`, so a write must land in ONE
 * partition: the one `?scenario=` names, or the base case's when it is absent.
 * Matching on id + client alone let a call aimed at a scenario's row rewrite
 * (or delete) whichever partition held the id — including the base plan's.
 *
 * Mocked at the db / auth seams, so it runs without a database. The live-DB
 * suite beside it covers the same routes end to end.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveScenarioId = vi.fn();
const updateWhere = vi.fn();
const deleteWhere = vi.fn();
const setSpy = vi.fn();

vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  // Tagged tuples, so a test can assert the exact constraint list.
  and: (...parts: unknown[]) => ({ and: parts }),
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
}));

vi.mock("@/db", () => ({
  db: {
    update: () => ({
      set: (v: unknown) => {
        setSpy(v);
        return { where: (w: unknown) => ({ returning: () => updateWhere(w) }) };
      },
    }),
    delete: () => ({ where: (w: unknown) => ({ returning: () => deleteWhere(w) }) }),
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
  },
}));
vi.mock("@/lib/db-helpers", () => ({
  requireOrgAndUser: vi.fn().mockResolvedValue({ orgId: "org1", userId: "u1" }),
}));
vi.mock("@/lib/clients/authz", () => ({
  requireClientEditAccess: vi.fn().mockResolvedValue({ firmId: "f1", access: "own" }),
}));
vi.mock("@/lib/authz", () => ({
  requireActiveSubscriptionForFirm: vi.fn().mockResolvedValue(undefined),
  authErrorResponse: () => null,
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/scenario/resolve-scenario-param", () => ({
  resolveScenarioId: (...a: unknown[]) => resolveScenarioId(...a),
}));

import { giftSeries } from "@/db/schema";
import { PATCH, DELETE } from "../[seriesId]/route";

const CLIENT = "c1";
const SERIES = "gs1";

function req(method: "PATCH" | "DELETE", qs = ""): never {
  return new Request(
    `http://localhost/api/clients/${CLIENT}/gifts/series/${SERIES}${qs}`,
    {
      method,
      headers: { "content-type": "application/json" },
      body: method === "PATCH" ? JSON.stringify({ annualAmount: 20000 }) : undefined,
    },
  ) as never;
}
const ctx = { params: Promise.resolve({ id: CLIENT, seriesId: SERIES }) };

/** The exact constraint list a partition-scoped write must carry. */
const scopedWhere = (scenarioId: string) => ({
  and: [
    { eq: [giftSeries.id, SERIES] },
    { eq: [giftSeries.clientId, CLIENT] },
    { eq: [giftSeries.scenarioId, scenarioId] },
  ],
});

describe("gift series [seriesId] route — partition scoping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateWhere.mockResolvedValue([{ id: SERIES }]);
    deleteWhere.mockResolvedValue([{ id: SERIES }]);
  });

  it("PATCH with ?scenario=S writes only a row in partition S", async () => {
    resolveScenarioId.mockResolvedValue("S");
    const res = await PATCH(req("PATCH", "?scenario=S"), ctx);
    expect(res.status).toBe(200);
    expect(resolveScenarioId).toHaveBeenCalledWith(CLIENT, "S");
    expect(updateWhere).toHaveBeenCalledWith(scopedWhere("S"));
  });

  it("DELETE with ?scenario=S deletes only a row in partition S", async () => {
    resolveScenarioId.mockResolvedValue("S");
    const res = await DELETE(req("DELETE", "?scenario=S"), ctx);
    expect(res.status).toBe(200);
    expect(deleteWhere).toHaveBeenCalledWith(scopedWhere("S"));
  });

  it("a wrong-partition id (nothing matches in S) → 404 on both verbs", async () => {
    resolveScenarioId.mockResolvedValue("S");
    updateWhere.mockResolvedValue([]);
    deleteWhere.mockResolvedValue([]);
    expect((await PATCH(req("PATCH", "?scenario=S"), ctx)).status).toBe(404);
    expect((await DELETE(req("DELETE", "?scenario=S"), ctx)).status).toBe(404);
  });

  it("another client's / unknown scenario → 404 before any write", async () => {
    resolveScenarioId.mockResolvedValue(undefined);
    expect((await PATCH(req("PATCH", "?scenario=foreign"), ctx)).status).toBe(404);
    expect((await DELETE(req("DELETE", "?scenario=foreign"), ctx)).status).toBe(404);
    expect(updateWhere).not.toHaveBeenCalled();
    expect(deleteWhere).not.toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalled();
  });

  it("base mode (no param) targets the base-case partition", async () => {
    resolveScenarioId.mockResolvedValue("BASE");
    expect((await PATCH(req("PATCH"), ctx)).status).toBe(200);
    expect((await DELETE(req("DELETE"), ctx)).status).toBe(200);
    expect(resolveScenarioId).toHaveBeenCalledWith(CLIENT, null);
    expect(updateWhere).toHaveBeenCalledWith(scopedWhere("BASE"));
    expect(deleteWhere).toHaveBeenCalledWith(scopedWhere("BASE"));
  });
});

/**
 * GET /api/clients/[id]/gifts/series?scenario=S — the list also carries the
 * scenario's overlay series (recurring gifts that exist only as `gift` changes),
 * marked `overlay: true`, so a surface that lists series by recipient (the trust
 * dialog's Transfers tab) sees them beside the partition rows. An overlay add on
 * a partition row's id replaces that row. No `?scenario=` is the plain partition
 * list, unchanged.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveScenarioId = vi.fn();
const loadActiveGiftChanges = vi.fn();
let partitionRows: Array<Record<string, unknown>> = [];

vi.mock("@/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => Promise.resolve(partitionRows) }) }) },
}));
vi.mock("@/lib/scenario/resolve-scenario-param", () => ({
  resolveScenarioId: (...a: unknown[]) => resolveScenarioId(...a),
  getBaseCaseScenarioId: vi.fn(),
}));
vi.mock("@/lib/scenario/changes", () => ({
  loadActiveGiftChanges: (...a: unknown[]) => loadActiveGiftChanges(...a),
}));

import { GET } from "../route";

const ctx = { params: Promise.resolve({ id: "c1" }) };
const get = (qs = "") =>
  GET(new Request(`http://localhost/api/clients/c1/gifts/series${qs}`) as never, ctx);

const draft = (id: string, annualAmount: number) => ({
  kind: "series", id, startYear: 2028, endYear: 2032, annualAmount,
  amountMode: "fixed", inflationAdjust: false, grantor: "client",
  recipient: { kind: "entity", id: "t1" }, crummey: false,
});
const change = (opType: "add" | "remove", targetId: string, payload: unknown) => ({
  id: "ch", scenarioId: "S", opType, targetKind: "gift", targetId, payload,
  toggleGroupId: null, orderIndex: 0,
});

describe("GET gifts/series — overlay series", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    partitionRows = [{ id: "p1", recipientEntityId: "t1", annualAmount: "19000.00" }];
    resolveScenarioId.mockResolvedValue("S");
    loadActiveGiftChanges.mockResolvedValue([]);
  });

  it("appends the scenario's overlay series, marked overlay, after the partition rows", async () => {
    loadActiveGiftChanges.mockResolvedValue([change("add", "ov1", draft("ov1", 7000))]);
    const body = await (await get("?scenario=S")).json();
    expect(body.map((r: { id: string }) => r.id)).toEqual(["p1", "ov1"]);
    expect(body[1]).toMatchObject({ id: "ov1", recipientEntityId: "t1", annualAmount: 7000, overlay: true });
    expect(body[0].overlay).toBeUndefined();
  });

  it("an overlay add on a partition row's id replaces it; a remove drops it", async () => {
    loadActiveGiftChanges.mockResolvedValue([change("add", "p1", draft("p1", 25000))]);
    let body = await (await get("?scenario=S")).json();
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ id: "p1", annualAmount: 25000, overlay: true });

    loadActiveGiftChanges.mockResolvedValue([change("remove", "p1", null)]);
    body = await (await get("?scenario=S")).json();
    expect(body).toEqual([]);
  });

  it("without ?scenario= it is the plain partition list and reads no changes", async () => {
    resolveScenarioId.mockResolvedValue("BASE");
    const body = await (await get()).json();
    expect(body).toEqual(partitionRows);
    expect(loadActiveGiftChanges).not.toHaveBeenCalled();
  });
});

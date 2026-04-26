// src/app/api/clients/[id]/snapshots/__tests__/route.test.ts
//
// Unit tests for the snapshots collection route. Mocks at the lib boundary
// (`requireOrgId`, `findClientInFirm`, `createSnapshot`, `recordAudit`, and
// the drizzle `db` chain) so the suite runs without a live database — the
// real DB round-trip lives in `src/lib/scenario/__tests__/snapshot.test.ts`.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "user_test", orgId: "firm_test" }),
}));

vi.mock("@/lib/db-helpers", () => ({
  requireOrgId: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {
    constructor(message = "Unauthorized") {
      super(message);
      this.name = "UnauthorizedError";
    }
  },
}));

vi.mock("@/lib/db-scoping", () => ({
  findClientInFirm: vi.fn<
    () => Promise<{ id: string } | null>
  >(),
}));

vi.mock("@/lib/audit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit")>(
    "@/lib/audit",
  );
  return { ...actual, recordAudit: vi.fn().mockResolvedValue(undefined) };
});

vi.mock("@/lib/scenario/snapshot", () => ({
  createSnapshot: vi.fn(),
}));

// `db.select()...orderBy()` chain for GET. `from(...).where(...).orderBy(...)`
// resolves to the rows array (drizzle's chain is a thenable at the leaf).
vi.mock("@/db", () => {
  const orderBy = vi.fn().mockResolvedValue([
    {
      id: "snap-1",
      name: "First",
      sourceKind: "manual",
      frozenAt: new Date("2026-04-01T00:00:00Z"),
    },
  ]);
  const where = vi.fn(() => ({ orderBy }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return { db: { select } };
});

import { requireOrgId } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import { recordAudit } from "@/lib/audit";
import { createSnapshot } from "@/lib/scenario/snapshot";
import { GET, POST } from "../route";

const CLIENT_ID = "cli_test";
const FIRM_ID = "firm_test";

function makeReq(url: string, init?: RequestInit) {
  return new Request(url, init) as unknown as import("next/server").NextRequest;
}

beforeEach(() => {
  vi.mocked(requireOrgId).mockReset();
  vi.mocked(findClientInFirm).mockReset();
  vi.mocked(recordAudit).mockClear();
  vi.mocked(createSnapshot).mockReset();
});

describe("GET /api/clients/[id]/snapshots", () => {
  it("returns 401 when there is no Clerk org context", async () => {
    const { UnauthorizedError } = await import("@/lib/db-helpers");
    vi.mocked(requireOrgId).mockRejectedValueOnce(new UnauthorizedError());

    const res = await GET(makeReq("http://test.local"), {
      params: Promise.resolve({ id: CLIENT_ID }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 404 when the client is not in the caller's firm", async () => {
    vi.mocked(requireOrgId).mockResolvedValueOnce(FIRM_ID);
    vi.mocked(findClientInFirm).mockResolvedValueOnce(
      null as unknown as { id: string },
    );

    const res = await GET(makeReq("http://test.local"), {
      params: Promise.resolve({ id: CLIENT_ID }),
    });
    expect(res.status).toBe(404);
  });

  it("returns the snapshots list on the happy path", async () => {
    vi.mocked(requireOrgId).mockResolvedValueOnce(FIRM_ID);
    vi.mocked(findClientInFirm).mockResolvedValueOnce({ id: CLIENT_ID });

    const res = await GET(makeReq("http://test.local"), {
      params: Promise.resolve({ id: CLIENT_ID }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      snapshots: Array<{ id: string; name: string }>;
    };
    expect(body.snapshots).toHaveLength(1);
    expect(body.snapshots[0]).toMatchObject({
      id: "snap-1",
      name: "First",
      sourceKind: "manual",
    });
  });
});

describe("POST /api/clients/[id]/snapshots", () => {
  function postReq(body: unknown) {
    return makeReq("http://test.local", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("returns 401 when there is no Clerk org context", async () => {
    const { UnauthorizedError } = await import("@/lib/db-helpers");
    vi.mocked(requireOrgId).mockRejectedValueOnce(new UnauthorizedError());

    const res = await POST(
      postReq({ left: "base", right: "s1", name: "x" }),
      { params: Promise.resolve({ id: CLIENT_ID }) },
    );
    expect(res.status).toBe(401);
    expect(vi.mocked(createSnapshot)).not.toHaveBeenCalled();
    expect(vi.mocked(recordAudit)).not.toHaveBeenCalled();
  });

  it("returns 404 when the client is not in the caller's firm", async () => {
    vi.mocked(requireOrgId).mockResolvedValueOnce(FIRM_ID);
    vi.mocked(findClientInFirm).mockResolvedValueOnce(
      null as unknown as { id: string },
    );

    const res = await POST(
      postReq({ left: "base", right: "s1", name: "x" }),
      { params: Promise.resolve({ id: CLIENT_ID }) },
    );
    expect(res.status).toBe(404);
    expect(vi.mocked(createSnapshot)).not.toHaveBeenCalled();
    expect(vi.mocked(recordAudit)).not.toHaveBeenCalled();
  });

  it("returns 400 on a malformed body (missing name)", async () => {
    vi.mocked(requireOrgId).mockResolvedValueOnce(FIRM_ID);
    vi.mocked(findClientInFirm).mockResolvedValueOnce({ id: CLIENT_ID });

    const res = await POST(postReq({ left: "base", right: "s1" }), {
      params: Promise.resolve({ id: CLIENT_ID }),
    });
    expect(res.status).toBe(400);
    expect(vi.mocked(createSnapshot)).not.toHaveBeenCalled();
  });

  it("returns 400 when left === right (no diff to freeze)", async () => {
    vi.mocked(requireOrgId).mockResolvedValueOnce(FIRM_ID);
    vi.mocked(findClientInFirm).mockResolvedValueOnce({ id: CLIENT_ID });

    const res = await POST(
      postReq({ left: "base", right: "base", name: "noop" }),
      { params: Promise.resolve({ id: CLIENT_ID }) },
    );
    expect(res.status).toBe(400);
    expect(vi.mocked(createSnapshot)).not.toHaveBeenCalled();
  });

  it("creates the snapshot, audits, and returns the row on success", async () => {
    vi.mocked(requireOrgId).mockResolvedValueOnce(FIRM_ID);
    vi.mocked(findClientInFirm).mockResolvedValueOnce({ id: CLIENT_ID });
    vi.mocked(createSnapshot).mockResolvedValueOnce({
      id: "snap-new",
      clientId: CLIENT_ID,
      name: "Q1 review",
    } as never);

    const res = await POST(
      postReq({
        left: "base",
        right: "s1",
        toggleState: { "g-1": true },
        name: "Q1 review",
        sourceKind: "manual",
      }),
      { params: Promise.resolve({ id: CLIENT_ID }) },
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { snapshot: { id: string } };
    expect(body.snapshot.id).toBe("snap-new");

    // Refs are reconstructed server-side: left=base → base scenario ref; right
    // is the live scenario id with toggleState honored.
    expect(vi.mocked(createSnapshot)).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: CLIENT_ID,
        firmId: FIRM_ID,
        name: "Q1 review",
        sourceKind: "manual",
        userId: "user_test",
        leftRef: { kind: "scenario", id: "base", toggleState: {} },
        rightRef: {
          kind: "scenario",
          id: "s1",
          toggleState: { "g-1": true },
        },
      }),
    );

    expect(vi.mocked(recordAudit)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "snapshot.create",
        resourceType: "scenario_snapshot",
        resourceId: "snap-new",
        clientId: CLIENT_ID,
        firmId: FIRM_ID,
        metadata: expect.objectContaining({
          name: "Q1 review",
          sourceKind: "manual",
          left: "base",
          right: "s1",
        }),
      }),
    );
  });

  it("resolves a snap:<id> left side into a snapshot ref", async () => {
    vi.mocked(requireOrgId).mockResolvedValueOnce(FIRM_ID);
    vi.mocked(findClientInFirm).mockResolvedValueOnce({ id: CLIENT_ID });
    vi.mocked(createSnapshot).mockResolvedValueOnce({
      id: "snap-2",
    } as never);

    const res = await POST(
      postReq({
        left: "snap:older-snap",
        right: "s1",
        name: "Compare against frozen",
      }),
      { params: Promise.resolve({ id: CLIENT_ID }) },
    );
    expect(res.status).toBe(201);

    expect(vi.mocked(createSnapshot)).toHaveBeenCalledWith(
      expect.objectContaining({
        leftRef: { kind: "snapshot", id: "older-snap", side: "left" },
        rightRef: { kind: "scenario", id: "s1", toggleState: {} },
      }),
    );
  });
});

// GET /api/clients/[id] — which failures may become a 404.
//
// `requireClientAccess` raises UnauthorizedError / ForbiddenError for genuine
// authz outcomes; ForbiddenError deliberately merges "not found" with "access
// denied" so client existence never leaks across firms. Everything else it can
// raise is a fault (dropped connection, missing column, driver error) and must
// surface as a 500 — a bare `.catch(() => null)` here reported the 2026-07-30
// prod outage as "this client doesn't exist" for as long as it took to notice.
//
// The gate itself is mocked on purpose: this file asserts the CALLER's error
// mapping, not the gate's decisions (those live in
// src/lib/clients/__tests__/authz.test.ts).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ForbiddenError } from "@/lib/authz";
import { UnauthorizedError } from "@/lib/db-helpers";

vi.mock("@/lib/clients/authz", () => ({
  requireClientAccess: vi.fn(),
  requireClientEditAccess: vi.fn(),
}));

import { GET } from "../route";
import { requireClientAccess } from "@/lib/clients/authz";

const params = Promise.resolve({ id: "c1" });
const req = () => new Request("http://test.local") as unknown as import("next/server").NextRequest;

describe("GET /api/clients/[id] — access error mapping", () => {
  beforeEach(() => {
    vi.mocked(requireClientAccess).mockReset();
  });

  it("returns the client on success", async () => {
    vi.mocked(requireClientAccess).mockResolvedValue({
      client: { id: "c1", firmId: "f1" },
      firmId: "f1",
      permission: "edit",
      access: "own",
    } as never);

    const res = await GET(req(), { params });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ id: "c1" });
  });

  it("maps ForbiddenError to 404 so client existence never leaks", async () => {
    vi.mocked(requireClientAccess).mockRejectedValue(
      new ForbiddenError("Client not found or access denied"),
    );

    const res = await GET(req(), { params });
    expect(res.status).toBe(404);
  });

  it("maps UnauthorizedError to 404 (unchanged from before the narrowing)", async () => {
    vi.mocked(requireClientAccess).mockRejectedValue(new UnauthorizedError());

    const res = await GET(req(), { params });
    expect(res.status).toBe(404);
  });

  it("surfaces a DB fault as 500, NOT 404", async () => {
    // The exact shape of the 2026-07-30 incident: migration 0228 added two
    // NOT NULL columns that prod lacked, so Drizzle's `select *` threw 42703.
    const dbFault = Object.assign(
      new Error('column clients.covered_by_workplace_plan does not exist'),
      { code: "42703" },
    );
    vi.mocked(requireClientAccess).mockRejectedValue(dbFault);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET(req(), { params });

    expect(res.status).not.toBe(404);
    expect(res.status).toBe(500);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("surfaces a dropped connection as 500, NOT 404", async () => {
    vi.mocked(requireClientAccess).mockRejectedValue(
      new Error("Connection terminated unexpectedly"),
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET(req(), { params });

    expect(res.status).not.toBe(404);
    expect(res.status).toBe(500);
    errSpy.mockRestore();
  });
});

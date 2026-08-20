import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveMock = vi.fn();
vi.mock("@/lib/portal/resolve-portal-client", () => ({
  resolvePortalClient: () => resolveMock(),
}));
const authErrMock = vi.fn<(e: unknown) => { status: number; body: { error: string } } | null>(() => null);
vi.mock("@/lib/authz", () => ({ authErrorResponse: (e: unknown) => authErrMock(e) }));
const featureMock = vi.fn();
vi.mock("@/lib/portal/load-features", () => ({
  requirePortalFeature: (...a: unknown[]) => featureMock(...a),
}));
const sharedMock = vi.fn();
vi.mock("@/lib/portal/privacy", () => ({
  requireAreaShared: (...a: unknown[]) => sharedMock(...a),
}));
const loadMock = vi.fn();
vi.mock("@/lib/portal/load-recurring-suggestions", () => ({
  loadRecurringSuggestions: (...a: unknown[]) => loadMock(...a),
}));

import { GET } from "@/app/api/portal/recurrings/suggestions/route";

function req(qs = ""): Request {
  return new Request(`http://localhost/api/portal/recurrings/suggestions${qs}`);
}

beforeEach(() => {
  resolveMock.mockReset();
  resolveMock.mockResolvedValue({ clientId: "c1", mode: "client" });
  featureMock.mockReset();
  featureMock.mockResolvedValue(undefined);
  sharedMock.mockReset();
  sharedMock.mockResolvedValue(undefined);
  loadMock.mockReset();
  loadMock.mockResolvedValue([{ key: "monthly:calm:15", name: "Calm" }]);
  authErrMock.mockReset();
  authErrMock.mockReturnValue(null);
});

describe("GET /api/portal/recurrings/suggestions", () => {
  it("scope=wide runs the deeper search", async () => {
    const res = await GET(req("?scope=wide"));
    expect(res.status).toBe(200);
    expect((await res.json()).suggestions).toHaveLength(1);
    expect(loadMock).toHaveBeenCalledWith("c1", expect.any(Date), "wide");
  });

  it("anything else stays on the strict pass — a bad query string cannot widen it", async () => {
    for (const qs of ["", "?scope=", "?scope=WIDE", "?scope=everything"]) {
      loadMock.mockClear();
      await GET(req(qs));
      expect(loadMock).toHaveBeenCalledWith("c1", expect.any(Date), "strict");
    }
  });

  it("is behind the Budget switch and the recurrings share setting", async () => {
    await GET(req("?scope=wide"));
    expect(featureMock).toHaveBeenCalledWith("c1", "budget");
    expect(sharedMock).toHaveBeenCalledWith("client", "c1", "recurrings");
  });

  it("a closed gate is the auth error, not a 200 with suggestions", async () => {
    featureMock.mockRejectedValue(new Error("gated"));
    authErrMock.mockReturnValue({ status: 403, body: { error: "Forbidden" } });
    const res = await GET(req("?scope=wide"));
    expect(res.status).toBe(403);
    expect(loadMock).not.toHaveBeenCalled();
  });
});

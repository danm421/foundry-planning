import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), suggestAttendees: vi.fn() }));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/workspace/attendee-suggestions", () => ({ suggestAttendees: mocks.suggestAttendees }));

import { GET } from "./route";

const get = (q?: string) => GET(new Request(`https://app.test/api/workspace/attendee-suggestions${q === undefined ? "" : `?q=${q}`}`));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("WORKSPACE_ENABLED", "true");
  mocks.auth.mockResolvedValue({ userId: "user_ada", orgId: "org_1", orgRole: "org:member" });
  mocks.suggestAttendees.mockResolvedValue([{ email: "a@c.com", name: "Ann", kind: "client" }]);
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/workspace/attendee-suggestions", () => {
  it("passes the session firm, user and role through", async () => {
    const res = await get("an");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ suggestions: [{ email: "a@c.com", name: "Ann", kind: "client" }] });
    expect(mocks.suggestAttendees).toHaveBeenCalledWith({ firmId: "org_1", userId: "user_ada", orgRole: "org:member", query: "an" });
  });

  it("treats a missing q as an empty query", async () => {
    await get();
    expect(mocks.suggestAttendees).toHaveBeenCalledWith(expect.objectContaining({ query: "" }));
  });

  it("is 404 when Workspace is off", async () => {
    vi.stubEnv("WORKSPACE_ENABLED", "false");
    expect((await get("an")).status).toBe(404);
  });
});

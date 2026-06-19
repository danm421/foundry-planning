import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("@/lib/orion/connections", () => ({ listConnectedFirmIds: vi.fn().mockResolvedValue(["firm_1", "firm_2"]) }));
vi.mock("@/lib/orion/sync", () => ({
  syncFirm: vi.fn()
    .mockResolvedValueOnce({ committed: 1, queued: 0 })
    .mockRejectedValueOnce(new Error("firm_2 boom")),
}));
import { GET } from "./route";
beforeEach(() => { process.env.CRON_SECRET = "s3cr3t"; vi.clearAllMocks(); });

function req(auth?: string) {
  return new Request("https://app.test/api/cron/orion-sync", { headers: auth ? { authorization: auth } : {} }) as never;
}

describe("orion-sync cron", () => {
  it("401s without the bearer secret", async () => {
    expect((await GET(req())).status).toBe(401);
  });
  it("runs all firms and isolates a failing one", async () => {
    const res = await GET(req("Bearer s3cr3t"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.firms).toBe(2);
    expect(body.failed).toBe(1);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("@/lib/integrations/connections", () => ({ listConnectedFirms: vi.fn() }));
vi.mock("@/lib/integrations/sync", () => ({ syncFirm: vi.fn() }));
// Registry is intentionally NOT mocked — getProvider(...).isEnabled() must run
// for real so the flag-skip path is actually exercised.
import { listConnectedFirms } from "@/lib/integrations/connections";
import { syncFirm } from "@/lib/integrations/sync";
import { GET } from "./route";

const ORIGINAL_SCHWAB_ENABLED = process.env.SCHWAB_ENABLED;

beforeEach(() => {
  process.env.CRON_SECRET = "s3cr3t";
  vi.clearAllMocks();
});

afterEach(() => {
  if (ORIGINAL_SCHWAB_ENABLED === undefined) {
    delete process.env.SCHWAB_ENABLED;
  } else {
    process.env.SCHWAB_ENABLED = ORIGINAL_SCHWAB_ENABLED;
  }
});

function req(auth?: string) {
  return new Request("https://app.test/api/cron/integration-sync", {
    headers: auth ? { authorization: auth } : {},
  }) as never;
}

describe("integration-sync cron", () => {
  it("401s without the cron bearer", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("syncs every connected (firm, provider) pair and isolates failures", async () => {
    vi.mocked(listConnectedFirms).mockResolvedValue([
      { firmId: "firm_1", providerId: "orion" },
      { firmId: "firm_2", providerId: "orion" },
    ]);
    vi.mocked(syncFirm)
      .mockRejectedValueOnce(new Error("boom")) // firm_1 fails
      .mockResolvedValueOnce({ committed: 1, queued: 0 });

    const res = await GET(req("Bearer s3cr3t"));

    expect(res.status).toBe(200);
    expect(syncFirm).toHaveBeenCalledTimes(2); // firm_2 still ran
    const body = await res.json();
    expect(body.firms).toBe(2);
    expect(body.failed).toBe(1);
  });

  it("skips providers whose flag is off", async () => {
    delete process.env.SCHWAB_ENABLED;
    vi.mocked(listConnectedFirms).mockResolvedValue([{ firmId: "firm_1", providerId: "schwab" }]);

    const res = await GET(req("Bearer s3cr3t"));

    expect(res.status).toBe(200);
    expect(syncFirm).not.toHaveBeenCalled();
  });
});

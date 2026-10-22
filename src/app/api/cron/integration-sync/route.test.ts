import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("@/lib/integrations/connections", () => ({ listConnectedSyncingConnections: vi.fn() }));
vi.mock("@/lib/integrations/sync", () => ({ syncConnection: vi.fn() }));
// Registry is intentionally NOT mocked — getProvider(...).isEnabled() must run
// for real so the flag-skip path is actually exercised.
import { listConnectedSyncingConnections } from "@/lib/integrations/connections";
import { syncConnection } from "@/lib/integrations/sync";
import { GET } from "./route";

const ORIGINAL_SCHWAB_ENABLED = process.env.SCHWAB_ENABLED;
const ORIGINAL_ORION_ENABLED = process.env.ORION_ENABLED;

beforeEach(() => {
  process.env.CRON_SECRET = "s3cr3t";
  process.env.ORION_ENABLED = "true";
  vi.clearAllMocks();
});

afterEach(() => {
  if (ORIGINAL_SCHWAB_ENABLED === undefined) {
    delete process.env.SCHWAB_ENABLED;
  } else {
    process.env.SCHWAB_ENABLED = ORIGINAL_SCHWAB_ENABLED;
  }
  if (ORIGINAL_ORION_ENABLED === undefined) {
    delete process.env.ORION_ENABLED;
  } else {
    process.env.ORION_ENABLED = ORIGINAL_ORION_ENABLED;
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
    expect(listConnectedSyncingConnections).not.toHaveBeenCalled();
  });

  it("syncs each connected connection once and isolates a failure", async () => {
    // Two connections in ONE firm: the run is per connection, not per firm.
    vi.mocked(listConnectedSyncingConnections).mockResolvedValue([
      { id: "conn_1", firmId: "firm_1", providerId: "orion" },
      { id: "conn_2", firmId: "firm_1", providerId: "orion" },
    ]);
    vi.mocked(syncConnection)
      .mockRejectedValueOnce(new Error("boom")) // conn_1 fails
      .mockResolvedValueOnce({ committed: 1, queued: 0 });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET(req("Bearer s3cr3t"));

    expect(res.status).toBe(200);
    expect(syncConnection).toHaveBeenCalledTimes(2); // conn_2 still ran
    expect(syncConnection).toHaveBeenNthCalledWith(1, "conn_1", { trigger: "cron" });
    expect(syncConnection).toHaveBeenNthCalledWith(2, "conn_2", { trigger: "cron" });
    expect(await res.json()).toEqual({ connections: 2, failed: 1 });
    expect(consoleError).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });

  it("skips providers whose flag is off", async () => {
    delete process.env.SCHWAB_ENABLED;
    vi.mocked(listConnectedSyncingConnections).mockResolvedValue([
      { id: "conn_1", firmId: "firm_1", providerId: "schwab" },
    ]);

    const res = await GET(req("Bearer s3cr3t"));

    expect(res.status).toBe(200);
    expect(syncConnection).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ connections: 1, failed: 0 });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/integrations/connection-access", () => ({ getOwnedConnection: vi.fn() }));
vi.mock("@/lib/integrations/connections", () => ({ disconnectConnectionById: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

import { POST } from "./route";
import { auth } from "@clerk/nextjs/server";
import { getOwnedConnection } from "@/lib/integrations/connection-access";
import { disconnectConnectionById } from "@/lib/integrations/connections";
import { recordAudit } from "@/lib/audit";

/* eslint-disable @typescript-eslint/no-explicit-any */

const CONN = "11111111-1111-4111-8111-111111111111";
const connection = { id: CONN, firmId: "firm_1", providerId: "addepar", ownerUserId: "u1", status: "connected" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ADDEPAR_ENABLED", "true");
  (auth as any).mockResolvedValue({ orgId: "firm_1", userId: "u1", orgRole: "org:member" });
  (getOwnedConnection as any).mockResolvedValue(connection);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const ctx = () => ({ params: Promise.resolve({ provider: "addepar", connectionId: CONN }) });
const post = () =>
  new Request(`https://app.test/api/integrations/addepar/connections/${CONN}/disconnect`, { method: "POST" });

describe("POST …/connections/[connectionId]/disconnect", () => {
  it("disconnects only the owner's connection", async () => {
    const res = await POST(post(), ctx());

    expect(res.status).toBe(200);
    expect(getOwnedConnection).toHaveBeenCalledWith({ connectionId: CONN, firmId: "firm_1", userId: "u1" });
    expect(disconnectConnectionById).toHaveBeenCalledTimes(1);
    expect(disconnectConnectionById).toHaveBeenCalledWith(CONN);
    expect(recordAudit).toHaveBeenCalledWith({
      action: "integration.disconnect",
      resourceType: "integration_connection",
      resourceId: CONN,
      firmId: "firm_1",
      metadata: { provider: "addepar", connectionId: CONN },
    });

    // A colleague naming the same id gets a 404 and changes nothing.
    vi.clearAllMocks();
    (auth as any).mockResolvedValue({ orgId: "firm_1", userId: "u2", orgRole: "org:member" });
    (getOwnedConnection as any).mockResolvedValue(null);

    const colleague = await POST(post(), ctx());

    expect(colleague.status).toBe(404);
    expect(disconnectConnectionById).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

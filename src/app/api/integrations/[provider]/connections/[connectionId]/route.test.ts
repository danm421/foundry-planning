import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/integrations/connection-access", () => ({ getOwnedConnection: vi.fn() }));
vi.mock("@/lib/integrations/connections", () => ({ deleteConnectionById: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

import { DELETE } from "./route";
import { auth } from "@clerk/nextjs/server";
import { getOwnedConnection } from "@/lib/integrations/connection-access";
import { deleteConnectionById } from "@/lib/integrations/connections";
import { recordAudit } from "@/lib/audit";

/* eslint-disable @typescript-eslint/no-explicit-any */

const CONN = "11111111-1111-4111-8111-111111111111";
const connection = { id: CONN, firmId: "firm_1", providerId: "addepar", ownerUserId: "u1", status: "disconnected" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ADDEPAR_ENABLED", "true");
  (auth as any).mockResolvedValue({ orgId: "firm_1", userId: "u1", orgRole: "org:member" });
  (getOwnedConnection as any).mockResolvedValue(connection);
  (deleteConnectionById as any).mockResolvedValue(3);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const ctx = () => ({ params: Promise.resolve({ provider: "addepar", connectionId: CONN }) });
const del = () =>
  new Request(`https://app.test/api/integrations/addepar/connections/${CONN}`, { method: "DELETE" });

describe("DELETE …/connections/[connectionId]", () => {
  it("deletes and audits integration.connection.delete", async () => {
    const res = await DELETE(del(), ctx());

    expect(res.status).toBe(200);
    expect(getOwnedConnection).toHaveBeenCalledWith({ connectionId: CONN, firmId: "firm_1", userId: "u1" });
    expect(deleteConnectionById).toHaveBeenCalledWith(CONN);
    expect(recordAudit).toHaveBeenCalledWith({
      action: "integration.connection.delete",
      resourceType: "integration_connection",
      resourceId: CONN,
      firmId: "firm_1",
      metadata: { provider: "addepar", connectionId: CONN, linksRemoved: 3 },
    });
  });

  it("404 for a colleague's connection — nothing deleted or audited", async () => {
    (getOwnedConnection as any).mockResolvedValue(null);

    const res = await DELETE(del(), ctx());

    expect(res.status).toBe(404);
    expect(deleteConnectionById).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

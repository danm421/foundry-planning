import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleClerkEvent, type ClerkEvent } from "../handler";

// Mock the seed helper so we test dispatch, not DB.
vi.mock("@/lib/cma-seed-runner", () => ({
  seedCmaForFirm: vi.fn(async (firmId: string) => ({
    assetClasses: 14,
    portfolios: 4,
    correlations: 78,
    inserted: {
      assetClasses: 14,
      portfolios: 4,
      allocations: 36,
      correlations: 78,
    },
  })),
}));

// Mock audit so tests don't require the audit_log table.
vi.mock("@/lib/audit", () => ({
  recordAudit: vi.fn(async () => {}),
}));

import { seedCmaForFirm } from "@/lib/cma-seed-runner";
import { recordAudit } from "@/lib/audit";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleClerkEvent", () => {
  it("seeds the new org on organization.created and audits as clerk:webhook", async () => {
    const evt: ClerkEvent = {
      type: "organization.created",
      data: { id: "org_abc123" },
    };

    const res = await handleClerkEvent(evt);

    expect(res.status).toBe(200);
    expect(seedCmaForFirm).toHaveBeenCalledWith("org_abc123");
    expect(seedCmaForFirm).toHaveBeenCalledTimes(1);

    // Webhook-triggered audits must tag actorId as "clerk:webhook" to
    // distinguish from admin-triggered reseeds (spec requirement).
    expect(recordAudit).toHaveBeenCalledTimes(1);
    const auditArgs = (recordAudit as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as {
      action: string;
      actorId?: string;
      firmId: string;
      metadata?: Record<string, unknown>;
    };
    expect(auditArgs.action).toBe("cma.seed");
    expect(auditArgs.actorId).toBe("clerk:webhook");
    expect(auditArgs.firmId).toBe("org_abc123");
    expect(auditArgs.metadata?.trigger).toBe("clerk.organization.created");
  });

  it("returns 200 no-op for unrelated event types", async () => {
    const evt: ClerkEvent = {
      type: "user.created",
      data: { id: "user_abc" },
    };

    const res = await handleClerkEvent(evt);

    expect(res.status).toBe(200);
    expect(seedCmaForFirm).not.toHaveBeenCalled();
  });

  it("returns 400 when organization.created payload lacks data.id", async () => {
    const evt = {
      type: "organization.created",
      data: {},
    } as unknown as ClerkEvent;

    const res = await handleClerkEvent(evt);

    expect(res.status).toBe(400);
    expect(seedCmaForFirm).not.toHaveBeenCalled();
  });

  it("returns 500 when the seed helper throws (so Clerk will retry)", async () => {
    (seedCmaForFirm as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("DB down")
    );
    const evt: ClerkEvent = {
      type: "organization.created",
      data: { id: "org_fail" },
    };

    const res = await handleClerkEvent(evt);

    expect(res.status).toBe(500);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: "user_abc" })),
}));

const insertValues = vi.fn();
vi.mock("@/db", () => ({
  db: {
    insert: () => ({ values: insertValues }),
  },
}));

import { recordAudit } from "@/lib/audit";

describe("recordAudit actorKind", () => {
  beforeEach(() => insertValues.mockReset());

  it("defaults actorKind to 'advisor'", async () => {
    await recordAudit({
      action: "crm.task.create",
      resourceType: "task",
      resourceId: "r1",
      firmId: "f1",
    });
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ actorKind: "advisor" }),
    );
  });

  it("accepts actorKind 'client'", async () => {
    await recordAudit({
      action: "crm.task.create",
      resourceType: "family_member",
      resourceId: "fm1",
      firmId: "f1",
      actorKind: "client",
    });
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ actorKind: "client" }),
    );
  });

  it("accepts actorKind 'system'", async () => {
    await recordAudit({
      action: "cma.seed",
      resourceType: "cma",
      resourceId: "f1",
      firmId: "f1",
      actorKind: "system",
    });
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ actorKind: "system" }),
    );
  });
});

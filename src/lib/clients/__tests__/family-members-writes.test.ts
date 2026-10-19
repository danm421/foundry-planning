// src/lib/clients/__tests__/family-members-writes.test.ts
//
// The family-member create core the route and the Forge share: access check,
// zod parse, insert, audit.
import { describe, it, expect, vi, beforeEach } from "vitest";

const values = vi.fn();
vi.mock("@/db", () => ({
  db: {
    insert: () => ({
      values: (v: unknown) => {
        values(v);
        return { returning: async () => [{ id: "fm-1", ...(v as object) }] };
      },
    }),
  },
}));
vi.mock("@/lib/clients/authz", () => ({ verifyClientAccessAs: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

import { createFamilyMemberForClient } from "../family-members-writes";
import { verifyClientAccessAs } from "@/lib/clients/authz";
import { recordAudit } from "@/lib/audit";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(verifyClientAccessAs).mockResolvedValue({ ok: true, permission: "edit", firmId: "org_1", access: "own" } as never);
});

describe("createFamilyMemberForClient", () => {
  it("stores a child from a first name alone and audits with the actor", async () => {
    const r = await createFamilyMemberForClient({
      clientId: "client_1",
      firmId: "org_1",
      actorId: "u1",
      input: { firstName: "Emma" },
    });

    expect(r.ok).toBe(true);
    expect(values).toHaveBeenCalledWith({
      clientId: "client_1",
      firstName: "Emma",
      lastName: null,
      relationship: "child",
      dateOfBirth: null,
      notes: null,
      domesticPartner: false,
      inheritanceClassOverride: {},
    });
    expect(recordAudit).toHaveBeenCalledWith({
      action: "family_member.create",
      resourceType: "family_member",
      resourceId: "fm-1",
      clientId: "client_1",
      firmId: "org_1",
      actorId: "u1",
      metadata: { firstName: "Emma", relationship: "child" },
    });
  });

  it("refuses an impossible date of birth before inserting", async () => {
    const r = await createFamilyMemberForClient({
      clientId: "client_1",
      firmId: "org_1",
      input: { firstName: "Emma", dateOfBirth: "2018-02-31" },
    });
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(values).not.toHaveBeenCalled();
  });

  it("is a 404 for a client in another firm", async () => {
    vi.mocked(verifyClientAccessAs).mockResolvedValue({ ok: true, permission: "edit", firmId: "org_2", access: "own" } as never);
    const r = await createFamilyMemberForClient({ clientId: "client_1", firmId: "org_1", input: { firstName: "Emma" } });
    expect(r).toEqual({ ok: false, status: 404, error: "Client not found" });
    expect(values).not.toHaveBeenCalled();
  });
});

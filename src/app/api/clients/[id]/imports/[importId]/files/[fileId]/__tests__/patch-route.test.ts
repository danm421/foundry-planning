// src/app/api/clients/[id]/imports/[importId]/files/[fileId]/__tests__/patch-route.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { SAVE_CLOSED_MESSAGE } from "@/lib/fact-finder/api-types";

vi.mock("@/lib/db-helpers", async (orig) => ({ ...(await orig<typeof import("@/lib/db-helpers")>()), requireOrgId: vi.fn().mockResolvedValue("firm1") }));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn().mockResolvedValue({ userId: "u1" }) }));
vi.mock("@/lib/clients/authz", () => ({ verifyClientAccess: vi.fn().mockResolvedValue({ ok: true, access: "own", permission: "edit", firmId: "firm1" }) }));
vi.mock("@/lib/imports/authz", async (orig) => ({ ...(await orig<typeof import("@/lib/imports/authz")>()), requireImportAccess: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkImportRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

// The update answers with the file row as patched.
const { mockUpdate } = vi.hoisted(() => ({ mockUpdate: vi.fn((patch: object) => patch) }));
vi.mock("@/db", () => ({
  db: {
    update: () => ({ set: (patch: object) => ({ where: () => ({ returning: async () => [{ id: "f1", ...mockUpdate(patch) }] }) }) }),
  },
}));

import { PATCH } from "../route";
import { requireImportAccess } from "@/lib/imports/authz";

const ctx = { params: Promise.resolve({ id: "c1", importId: "imp1", fileId: "f1" }) };
const CLOSED = { at: "2026-10-15T12:00:00.000Z", by: "u1", saved: [], leftOut: [] };
const importWith = (payloadJson: unknown) => ({ id: "imp1", payloadJson }) as Awaited<ReturnType<typeof requireImportAccess>>;
const patch = () =>
  PATCH(new NextRequest("http://x", { method: "PATCH", body: JSON.stringify({ documentType: "account_statement" }) }), ctx);

beforeEach(() => vi.clearAllMocks());

describe("PATCH /imports/[importId]/files/[fileId]", () => {
  it("refuses a fact finder import saved to the plan — 409 with the gate's reason and the saved fact finder — and changes nothing", async () => {
    vi.mocked(requireImportAccess).mockResolvedValueOnce(importWith({ factFinder: { version: 3, closed: CLOSED } }));
    const res = await patch();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe(SAVE_CLOSED_MESSAGE);
    expect(body.factFinder).toMatchObject({ version: 3, closed: CLOSED });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("still sets the document type on a fact finder import that isn't saved, and on any other import", async () => {
    for (const payloadJson of [{ factFinder: { version: 3 } }, null]) {
      vi.mocked(requireImportAccess).mockResolvedValueOnce(importWith(payloadJson));
      const res = await patch();
      expect(res.status).toBe(200);
      expect((await res.json()).file).toMatchObject({ id: "f1", documentType: "account_statement" });
    }
    expect(mockUpdate).toHaveBeenCalledTimes(2);
    expect(mockUpdate).toHaveBeenCalledWith({ documentType: "account_statement" });
  });
});

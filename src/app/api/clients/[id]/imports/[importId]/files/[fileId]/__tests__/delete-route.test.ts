// src/app/api/clients/[id]/imports/[importId]/files/[fileId]/__tests__/delete-route.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { SAVE_CLOSED_MESSAGE } from "@/lib/fact-finder/api-types";

vi.mock("@/lib/db-helpers", async (orig) => ({ ...(await orig<typeof import("@/lib/db-helpers")>()), requireOrgId: vi.fn().mockResolvedValue("firm1") }));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn().mockResolvedValue({ userId: "u1" }) }));
vi.mock("@/lib/clients/authz", () => ({ verifyClientAccess: vi.fn().mockResolvedValue({ ok: true, access: "own", permission: "edit", firmId: "firm1" }) }));
vi.mock("@/lib/imports/authz", async (orig) => ({ ...(await orig<typeof import("@/lib/imports/authz")>()), requireImportAccess: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkImportRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

const { mockUpdate } = vi.hoisted(() => ({ mockUpdate: vi.fn() }));
vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: "f1", deletedAt: null }] }) }) }),
    update: () => ({ set: (patch: unknown) => ({ where: async () => mockUpdate(patch) }) }),
  },
}));

import { DELETE } from "../route";
import { requireImportAccess } from "@/lib/imports/authz";

const ctx = { params: Promise.resolve({ id: "c1", importId: "imp1", fileId: "f1" }) };
const CLOSED = { at: "2026-10-15T12:00:00.000Z", by: "u1", saved: [], leftOut: [] };
const importWith = (payloadJson: unknown) => ({ id: "imp1", payloadJson }) as Awaited<ReturnType<typeof requireImportAccess>>;

beforeEach(() => vi.clearAllMocks());

describe("DELETE /imports/[importId]/files/[fileId]", () => {
  it("refuses a fact finder import saved to the plan — 409 with the gate's reason and the saved fact finder — and deletes nothing", async () => {
    vi.mocked(requireImportAccess).mockResolvedValueOnce(importWith({ factFinder: { version: 3, closed: CLOSED } }));
    const res = await DELETE(new NextRequest("http://x", { method: "DELETE" }), ctx);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe(SAVE_CLOSED_MESSAGE);
    expect(body.factFinder).toMatchObject({ version: 3, closed: CLOSED });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("still deletes a file of a fact finder import that isn't saved, and of any other import", async () => {
    for (const payloadJson of [{ factFinder: { version: 3 } }, null]) {
      vi.mocked(requireImportAccess).mockResolvedValueOnce(importWith(payloadJson));
      const res = await DELETE(new NextRequest("http://x", { method: "DELETE" }), ctx);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    }
    expect(mockUpdate).toHaveBeenCalledTimes(2);
  });

  it("still deletes a file of a finished statement-chat import (committed, no fact finder)", async () => {
    vi.mocked(requireImportAccess).mockResolvedValueOnce({ ...importWith({ chat: { surface: "chat" } }), status: "committed" });
    const res = await DELETE(new NextRequest("http://x", { method: "DELETE" }), ctx);
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });
});

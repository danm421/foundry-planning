import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db-helpers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db-helpers")>(
    "@/lib/db-helpers",
  );
  return { ...actual, requireOrgId: vi.fn() };
});
vi.mock("@/lib/authz", async () => {
  const actual = await vi.importActual<typeof import("@/lib/authz")>("@/lib/authz");
  return { ...actual, requireActiveSubscription: vi.fn() };
});
vi.mock("@/lib/imports/authz", async () => {
  const actual = await vi.importActual<typeof import("@/lib/imports/authz")>(
    "@/lib/imports/authz",
  );
  return { ...actual, requireImportAccess: vi.fn() };
});
vi.mock("@/lib/clients/authz", () => ({
  verifyClientAccess: vi
    .fn()
    .mockResolvedValue({ ok: true, permission: "edit", firmId: "org_1", access: "own" }),
}));
vi.mock("@/lib/rate-limit", () => ({ checkImportRateLimit: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/extraction/extract", () => ({ extractDocument: vi.fn() }));
vi.mock("@/lib/imports/blob", () => ({ downloadImportFile: vi.fn() }));
vi.mock("@/lib/imports/run-extraction", () => ({ runImportExtraction: vi.fn() }));

// After the gate, the route queries import files; return [] so an entitled
// firm short-circuits to a 400 ("No files") — proving it passed the guard
// without reaching extractDocument.
vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })),
    })),
    insert: vi.fn(),
    update: vi.fn(),
  },
}));

import { POST } from "../route";
import { auth } from "@clerk/nextjs/server";
import { requireOrgId } from "@/lib/db-helpers";
import { requireActiveSubscription, ForbiddenError } from "@/lib/authz";
import { requireImportAccess } from "@/lib/imports/authz";
import { checkImportRateLimit } from "@/lib/rate-limit";
import { extractDocument } from "@/lib/extraction/extract";
import { db } from "@/db";
import { SAVE_CLOSED_MESSAGE } from "@/lib/fact-finder/api-types";
import { runImportExtraction } from "@/lib/imports/run-extraction";

/** A fact finder saved to the plan: the import is committed, its closed record in the payload. */
const SAVED_ROW = {
  id: "i1",
  status: "committed",
  extractHoldings: false,
  payloadJson: { factFinder: { version: 3, closed: { at: "2026-10-16T09:00:00.000Z" } } },
};

function makeReq() {
  return new Request(
    "https://app.foundryplanning.com/api/clients/c1/imports/i1/extract",
    { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
  ) as never;
}
const params = { params: Promise.resolve({ id: "c1", importId: "i1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOrgId).mockResolvedValue("org_1");
  vi.mocked(requireActiveSubscription).mockResolvedValue(undefined);
  vi.mocked(requireImportAccess).mockResolvedValue(undefined as never);
  vi.mocked(auth).mockResolvedValue({ userId: "user_1" } as never);
  vi.mocked(checkImportRateLimit).mockResolvedValue({ allowed: true } as never);
});

describe("extract route entitlement guard", () => {
  it("403s with ai_import_not_entitled when the entitlement is absent", async () => {
    vi.mocked(auth).mockResolvedValue({
      userId: "user_1",
      sessionClaims: { org_public_metadata: { entitlements: [] } },
    } as never);

    const res = await POST(makeReq(), params);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "ai_import_not_entitled" });
    expect(extractDocument).not.toHaveBeenCalled();
  });

  it("passes the guard when the firm holds the ai_import entitlement", async () => {
    vi.mocked(auth).mockResolvedValue({
      userId: "user_1",
      sessionClaims: { org_public_metadata: { entitlements: ["ai_import"] } },
    } as never);

    // No files → 400 after the gate, proving we passed it without extracting.
    const res = await POST(makeReq(), params);
    expect(res.status).toBe(400);
    expect(extractDocument).not.toHaveBeenCalled();
  });

  it("a finished statement-chat import (committed, no fact finder) is read as before", async () => {
    vi.mocked(auth).mockResolvedValue({
      userId: "user_1",
      sessionClaims: { org_public_metadata: { entitlements: ["ai_import"] } },
    } as never);
    vi.mocked(db.select)
      .mockImplementationOnce((() => ({ from: () => ({ where: () => Promise.resolve([{ id: "f1" }]) }) })) as never)
      .mockImplementationOnce((() => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([{ ...SAVED_ROW, payloadJson: { chat: { surface: "chat" } } }]) }) }) })) as never);
    vi.mocked(runImportExtraction).mockResolvedValue({ succeeded: 1, failed: 0, status: "review", warnings: [], filesProcessed: 1 });

    const res = await POST(makeReq(), params);
    expect(res.status).toBe(200);
    expect(runImportExtraction).toHaveBeenCalledTimes(1);
  });

  it("refuses a fact finder saved to the plan before reading anything", async () => {
    vi.mocked(auth).mockResolvedValue({
      userId: "user_1",
      sessionClaims: { org_public_metadata: { entitlements: ["ai_import"] } },
    } as never);
    // The import's files, then the import row.
    vi.mocked(db.select)
      .mockImplementationOnce((() => ({ from: () => ({ where: () => Promise.resolve([{ id: "f1" }]) }) })) as never)
      .mockImplementationOnce((() => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([SAVED_ROW]) }) }) })) as never);

    const res = await POST(makeReq(), params);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: SAVE_CLOSED_MESSAGE });
    expect(extractDocument).not.toHaveBeenCalled();
    expect(runImportExtraction).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it("403s without an active subscription, before doing any work", async () => {
    vi.mocked(requireActiveSubscription).mockRejectedValue(
      new ForbiddenError("Active subscription required"),
    );
    const res = await POST(makeReq(), params);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Active subscription required" });
    expect(extractDocument).not.toHaveBeenCalled();
  });

  it("403s for a shared (cross-org) recipient with access='shared'", async () => {
    const { verifyClientAccess } = await import("@/lib/clients/authz");
    vi.mocked(verifyClientAccess).mockResolvedValueOnce({
      ok: true,
      permission: "edit",
      firmId: "org_owner",
      access: "shared",
    } as never);
    vi.mocked(auth).mockResolvedValue({
      userId: "user_1",
      sessionClaims: { org_public_metadata: { entitlements: ["ai_import"] } },
    } as never);

    const res = await POST(makeReq(), params);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Cross-organization imports are not supported." });
    expect(extractDocument).not.toHaveBeenCalled();
  });
});

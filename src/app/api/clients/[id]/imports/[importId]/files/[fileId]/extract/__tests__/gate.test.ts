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

// An entitled firm that gets past the guard finds no file and 404s, which
// proves the guard passed without reaching extractDocument or any write.
vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn(() => Promise.resolve([])) })),
      })),
    })),
    insert: vi.fn(),
    update: vi.fn(),
  },
}));

import { POST } from "../route";
import { db } from "@/db";
import { auth } from "@clerk/nextjs/server";
import { requireOrgId } from "@/lib/db-helpers";
import { requireActiveSubscription, ForbiddenError } from "@/lib/authz";
import { requireImportAccess } from "@/lib/imports/authz";
import { checkImportRateLimit } from "@/lib/rate-limit";
import { extractDocument } from "@/lib/extraction/extract";

function makeReq() {
  return new Request(
    "https://app.foundryplanning.com/api/clients/c1/imports/i1/files/f1/extract",
    { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
  ) as never;
}
const params = {
  params: Promise.resolve({ id: "c1", importId: "i1", fileId: "f1" }),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOrgId).mockResolvedValue("org_1");
  vi.mocked(requireActiveSubscription).mockResolvedValue(undefined);
  vi.mocked(requireImportAccess).mockResolvedValue(undefined as never);
  vi.mocked(auth).mockResolvedValue({ userId: "user_1" } as never);
  vi.mocked(checkImportRateLimit).mockResolvedValue({ allowed: true } as never);
});

describe("per-file re-extract route guards", () => {
  it("403s with ai_import_not_entitled when the entitlement is absent", async () => {
    vi.mocked(auth).mockResolvedValue({
      userId: "user_1",
      sessionClaims: { org_public_metadata: { entitlements: ["ai_forge"] } },
    } as never);

    const res = await POST(makeReq(), params);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "ai_import_not_entitled" });
    expect(extractDocument).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("passes the guard when the firm holds the ai_import entitlement", async () => {
    vi.mocked(auth).mockResolvedValue({
      userId: "user_1",
      sessionClaims: { org_public_metadata: { entitlements: ["ai_import"] } },
    } as never);

    const res = await POST(makeReq(), params);
    expect(res.status).toBe(404);
    expect(extractDocument).not.toHaveBeenCalled();
  });

  it("403s without an active subscription, before doing any work", async () => {
    vi.mocked(requireActiveSubscription).mockRejectedValue(
      new ForbiddenError("Active subscription required"),
    );
    const res = await POST(makeReq(), params);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Active subscription required" });
    expect(extractDocument).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });
});

// src/app/api/clients/[id]/imports/[importId]/fact-finder/__tests__/route.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db-helpers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db-helpers")>("@/lib/db-helpers");
  return { ...actual, requireOrgId: vi.fn() };
});
vi.mock("@/lib/authz", async () => {
  const actual = await vi.importActual<typeof import("@/lib/authz")>("@/lib/authz");
  return { ...actual, requireActiveSubscription: vi.fn() };
});
vi.mock("@/lib/imports/authz", async () => {
  const actual = await vi.importActual<typeof import("@/lib/imports/authz")>("@/lib/imports/authz");
  return { ...actual, requireImportAccess: vi.fn() };
});
vi.mock("@/lib/clients/authz", () => ({
  verifyClientAccess: vi.fn().mockResolvedValue({ ok: true, permission: "edit", firmId: "org_1", access: "own" }),
}));
vi.mock("@/lib/rate-limit", () => ({ checkImportRateLimit: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/fact-finder/persist", () => ({ writeFactFinder: vi.fn(), loadFactFinder: vi.fn() }));
vi.mock("@/db", () => ({ db: {} }));

import { GET, PATCH } from "../route";
import { auth } from "@clerk/nextjs/server";
import { requireOrgId } from "@/lib/db-helpers";
import { ForbiddenError as SubscriptionForbiddenError, requireActiveSubscription } from "@/lib/authz";
import { requireImportAccess } from "@/lib/imports/authz";
import { verifyClientAccess } from "@/lib/clients/authz";
import { checkImportRateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { loadFactFinder, writeFactFinder } from "@/lib/fact-finder/persist";
import { emptyFactFinderState } from "@/lib/fact-finder/state";
import type { FactFinderState } from "@/lib/fact-finder/types";

const params = { params: Promise.resolve({ id: "c1", importId: "i1" }) };
const CHAT_PAYLOAD = { chat: { surface: "chat" } };

function stored(version: number): FactFinderState {
  const s = emptyFactFinderState();
  return {
    ...s,
    version,
    sections: { ...s.sections, cash: [{ id: "r1", cells: {}, sourceFileIds: [] }] },
  };
}

function patch(body: unknown) {
  return new Request("http://t/api/clients/c1/imports/i1/fact-finder", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const get = () => new Request("http://t/api/clients/c1/imports/i1/fact-finder");
const setName = { op: "setCell", sectionId: "cash", rowId: "r1", columnId: "accountName", value: "Joint Checking" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOrgId).mockResolvedValue("org_1");
  vi.mocked(requireActiveSubscription).mockResolvedValue(undefined);
  vi.mocked(auth).mockResolvedValue({
    userId: "user_1",
    sessionClaims: { org_public_metadata: { entitlements: ["ai_import"] } },
  } as never);
  vi.mocked(checkImportRateLimit).mockResolvedValue({ allowed: true, remaining: 1, reset: 0 } as never);
  vi.mocked(requireImportAccess).mockResolvedValue({
    id: "i1",
    payloadJson: { ...CHAT_PAYLOAD, factFinder: stored(3) },
    createdByUserId: "user_1",
  } as never);
});

describe("gates", () => {
  it("401s without a user", async () => {
    vi.mocked(auth).mockResolvedValueOnce({ userId: null } as never);
    expect((await GET(get(), params)).status).toBe(401);
  });

  it("403s without a subscription, before touching the import", async () => {
    vi.mocked(requireActiveSubscription).mockRejectedValueOnce(new SubscriptionForbiddenError("Active subscription required"));
    expect((await GET(get(), params)).status).toBe(403);
    expect(requireImportAccess).not.toHaveBeenCalled();
  });

  it("404s a client the firm can't see, 403s a shared or view-only client", async () => {
    vi.mocked(verifyClientAccess).mockResolvedValueOnce({ ok: false });
    expect((await GET(get(), params)).status).toBe(404);
    vi.mocked(verifyClientAccess).mockResolvedValueOnce({ ok: true, permission: "edit", firmId: "org_2", access: "shared" } as never);
    expect(await (await GET(get(), params)).json()).toEqual({ error: "Cross-organization imports are not supported." });
    vi.mocked(verifyClientAccess).mockResolvedValueOnce({ ok: true, permission: "view", firmId: "org_1", access: "own" } as never);
    expect(await (await GET(get(), params)).json()).toEqual({ error: "View-only access" });
  });

  it("429s with Retry-After when the bucket is spent, and fails closed when unconfigured", async () => {
    vi.mocked(checkImportRateLimit).mockResolvedValueOnce({ allowed: false, reason: "exceeded", remaining: 0, reset: Date.now() + 5000 } as never);
    const limited = await GET(get(), params);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
    vi.mocked(checkImportRateLimit).mockResolvedValueOnce({ allowed: false, reason: "unconfigured" } as never);
    expect((await GET(get(), params)).status).toBe(503);
  });

  it("403s a firm without the AI import entitlement", async () => {
    vi.mocked(auth).mockResolvedValueOnce({ userId: "user_1", sessionClaims: { org_public_metadata: { entitlements: [] } } } as never);
    const res = await GET(get(), params);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "ai_import_not_entitled" });
  });

  it("400s an import that isn't a fact finder import", async () => {
    vi.mocked(requireImportAccess).mockResolvedValueOnce({ id: "i1", payloadJson: {}, createdByUserId: "user_1" } as never);
    expect((await GET(get(), params)).status).toBe(400);
  });

  it("uses the view bucket for GET and the edit bucket for PATCH", async () => {
    await GET(get(), params);
    expect(checkImportRateLimit).toHaveBeenLastCalledWith("org_1", "view");
    vi.mocked(writeFactFinder).mockResolvedValueOnce({ ...stored(3), version: 4 });
    await PATCH(patch({ baseVersion: 3, ops: [setName] }), params);
    expect(checkImportRateLimit).toHaveBeenLastCalledWith("org_1", "edit");
  });
});

describe("GET", () => {
  it("returns the stored fact finder, or an empty one for a fresh chat import", async () => {
    expect((await (await GET(get(), params)).json()).factFinder.version).toBe(3);
    vi.mocked(requireImportAccess).mockResolvedValueOnce({ id: "i1", payloadJson: CHAT_PAYLOAD, createdByUserId: "user_1" } as never);
    const fresh = await (await GET(get(), params)).json();
    expect(fresh.factFinder).toEqual(emptyFactFinderState());
  });
});

describe("PATCH", () => {
  it("applies the ops on the expected version and audits them", async () => {
    vi.mocked(writeFactFinder).mockImplementationOnce(async (_scope, base, next) => ({ ...next, version: base + 1 }));
    const res = await PATCH(patch({ baseVersion: 3, ops: [setName] }), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: 4 });
    const [scope, base, next] = vi.mocked(writeFactFinder).mock.calls[0];
    expect(scope).toEqual({ importId: "i1", clientId: "c1", firmId: "org_1" });
    expect(base).toBe(3);
    expect(next.sections.cash[0].cells.accountName).toEqual({ value: "Joint Checking", by: "advisor", pinned: true });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "import.payload.edited",
        resourceId: "i1",
        metadata: { surface: "fact_finder", ops: { setCell: 1 }, version: 4 },
      }),
    );
  });

  it("409s with the fresh state when the client's version is stale, without writing", async () => {
    const res = await PATCH(patch({ baseVersion: 2, ops: [setName] }), params);
    expect(res.status).toBe(409);
    expect((await res.json()).factFinder.version).toBe(3);
    expect(writeFactFinder).not.toHaveBeenCalled();
  });

  it("409s when another write lands between reading and writing", async () => {
    vi.mocked(writeFactFinder).mockResolvedValueOnce(null);
    vi.mocked(loadFactFinder).mockResolvedValueOnce(stored(4));
    const res = await PATCH(patch({ baseVersion: 3, ops: [setName] }), params);
    expect(res.status).toBe(409);
    expect((await res.json()).factFinder.version).toBe(4);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("400s an invalid body or an op the fact finder refuses", async () => {
    expect((await PATCH(patch({ ops: [setName] }), params)).status).toBe(400);
    expect((await PATCH(patch({ baseVersion: 3, ops: [{ op: "dropTable" }] }), params)).status).toBe(400);
    const res = await PATCH(patch({ baseVersion: 3, ops: [{ ...setName, columnId: "accountType", value: "Pension" }] }), params);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/isn't one of the options for Account type/);
    expect(writeFactFinder).not.toHaveBeenCalled();
  });
});

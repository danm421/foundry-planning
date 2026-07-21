import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db-helpers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db-helpers")>(
    "@/lib/db-helpers",
  );
  return { ...actual, requireOrgId: vi.fn() };
});
vi.mock("@/lib/authz", () => ({ requireActiveSubscription: vi.fn() }));
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
vi.mock("@/lib/imports/assemble/run-assemble", () => ({ runAssemble: vi.fn() }));

import { POST } from "../route";
import { auth } from "@clerk/nextjs/server";
import { requireOrgId } from "@/lib/db-helpers";
import { requireActiveSubscription } from "@/lib/authz";
import { requireImportAccess } from "@/lib/imports/authz";
import { checkImportRateLimit } from "@/lib/rate-limit";
import { runAssemble } from "@/lib/imports/assemble/run-assemble";

function makeReq(body: unknown = {}) {
  return new Request(
    "https://app.foundryplanning.com/api/clients/c1/imports/i1/assemble",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  ) as never;
}
const params = { params: Promise.resolve({ id: "c1", importId: "i1" }) };

const entitledClaims = {
  userId: "user_1",
  sessionClaims: { org_public_metadata: { entitlements: ["ai_import"] } },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOrgId).mockResolvedValue("org_1");
  vi.mocked(requireActiveSubscription).mockResolvedValue(undefined);
  vi.mocked(auth).mockResolvedValue(entitledClaims as never);
  vi.mocked(checkImportRateLimit).mockResolvedValue({ allowed: true } as never);
});

describe("assemble route guard + delegation", () => {
  it("delegates to runAssemble with derived mode + scenarioId when entitled and files exist", async () => {
    vi.mocked(requireImportAccess).mockResolvedValue({
      id: "i1",
      payloadJson: { fileResults: { f1: { warnings: [] } } },
      mode: "onboarding",
      scenarioId: "sc1",
    } as never);
    vi.mocked(runAssemble).mockResolvedValue({
      assemble: { version: 1, mergedFileCount: 1, assumptions: [], questions: [] },
      questionCount: 1,
      rowCount: 2,
    } as never);

    const res = await POST(makeReq({ known: { retirementAge: 65 } }), params);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      questionCount: 1,
      rowCount: 2,
      assemble: { version: 1, mergedFileCount: 1, assumptions: [], questions: [] },
    });
    expect(runAssemble).toHaveBeenCalledTimes(1);
    expect(runAssemble).toHaveBeenCalledWith(
      expect.objectContaining({
        importId: "i1",
        clientId: "c1",
        firmId: "org_1",
        mode: "new",
        scenarioId: "sc1",
        known: { retirementAge: 65 },
      }),
    );
  });

  it("400s without calling runAssemble when there are no extracted files", async () => {
    vi.mocked(requireImportAccess).mockResolvedValue({
      id: "i1",
      payloadJson: { fileResults: {} },
      mode: "onboarding",
      scenarioId: null,
    } as never);

    const res = await POST(makeReq(), params);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "No extracted files to assemble. Run extraction first.",
    });
    expect(runAssemble).not.toHaveBeenCalled();
  });

  it("403s with ai_import_not_entitled when the entitlement is absent", async () => {
    vi.mocked(auth).mockResolvedValue({
      userId: "user_1",
      sessionClaims: { org_public_metadata: { entitlements: [] } },
    } as never);
    vi.mocked(requireImportAccess).mockResolvedValue({
      id: "i1",
      payloadJson: { fileResults: { f1: {} } },
      mode: "onboarding",
      scenarioId: "sc1",
    } as never);

    const res = await POST(makeReq(), params);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "ai_import_not_entitled" });
    expect(runAssemble).not.toHaveBeenCalled();
  });
});

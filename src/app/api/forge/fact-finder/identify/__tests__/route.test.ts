import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db-helpers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db-helpers")>("@/lib/db-helpers");
  return { ...actual, requireOrgId: vi.fn().mockResolvedValue("org_1") };
});
vi.mock("@/lib/authz", async () => {
  const actual = await vi.importActual<typeof import("@/lib/authz")>("@/lib/authz");
  return { ...actual, requireActiveSubscription: vi.fn().mockResolvedValue(undefined) };
});
vi.mock("@/lib/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit");
  return { ...actual, checkForgeRateLimit: vi.fn().mockResolvedValue({ allowed: true }) };
});
vi.mock("@/lib/extraction/identify-household", () => ({ identifyHousehold: vi.fn() }));
vi.mock("@/lib/crm/households", () => ({ listCrmHouseholds: vi.fn().mockResolvedValue([]) }));

import { POST } from "../route";
import { auth } from "@clerk/nextjs/server";
import { identifyHousehold } from "@/lib/extraction/identify-household";

/** A minimal but genuine PDF header so detectUploadKind accepts the upload. */
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

function makeReq(): Request {
  const body = new FormData();
  body.set("file", new File([PDF_BYTES as BlobPart], "fact-finder.pdf", { type: "application/pdf" }));
  return new Request("https://app.foundryplanning.com/api/forge/fact-finder/identify", {
    method: "POST",
    body,
  });
}

function signedInWith(entitlements: string[]) {
  vi.mocked(auth).mockResolvedValue({
    userId: "user_1",
    sessionClaims: { org_public_metadata: { entitlements } },
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("FORGE_ENABLED", "true");
  vi.mocked(identifyHousehold).mockResolvedValue({ isHouseholdDoc: false } as never);
});

describe("POST /api/forge/fact-finder/identify", () => {
  it("403s without reading the document when the firm's AI import is off", async () => {
    signedInWith(["ai_forge"]);
    const res = await POST(makeReq());

    expect(res.status).toBe(403);
    expect(identifyHousehold).not.toHaveBeenCalled();
  });

  it("reads the document when the firm holds both Forge and AI import", async () => {
    signedInWith(["ai_forge", "ai_import"]);
    const res = await POST(makeReq());

    expect(res.status).toBe(200);
    expect(identifyHousehold).toHaveBeenCalledOnce();
  });
});

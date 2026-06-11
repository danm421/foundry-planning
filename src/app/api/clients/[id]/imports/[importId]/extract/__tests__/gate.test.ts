import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
}));
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
// Phase-1b advisor gate runs before the quota check; this suite exercises the
// entitlement/quota gate, not the access path, so let the client gate pass.
vi.mock("@/lib/clients/authz", () => ({
  verifyClientAccess: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkImportRateLimit: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/extraction/extract", () => ({ extractDocument: vi.fn() }));
vi.mock("@/lib/imports/blob", () => ({ downloadImportFile: vi.fn() }));

const firmsRow = vi.fn();
vi.mock("@/db", () => ({
  db: {
    // chainable select().from().where().limit() / .then for the firms lookup
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(firmsRow())),
        })),
      })),
    })),
    insert: vi.fn(),
    update: vi.fn(),
  },
}));

import { POST } from "../route";
import { auth } from "@clerk/nextjs/server";
import { requireOrgId } from "@/lib/db-helpers";
import { requireActiveSubscription } from "@/lib/authz";
import { requireImportAccess } from "@/lib/imports/authz";
import { checkImportRateLimit } from "@/lib/rate-limit";
import { extractDocument } from "@/lib/extraction/extract";

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

describe("extract route entitlement/quota gate", () => {
  it("402s when quota is exhausted and the ai_import entitlement is absent", async () => {
    vi.mocked(auth).mockResolvedValue({
      userId: "user_1",
      sessionClaims: { org_public_metadata: { entitlements: [] } },
    } as never);
    firmsRow.mockReturnValue([{ aiImportsUsed: 3 }]); // == AI_IMPORT_FREE_QUOTA

    const res = await POST(makeReq(), params);
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: "ai_import_quota_exhausted" });
    expect(extractDocument).not.toHaveBeenCalled();
  });

  it("does not 402 when the firm holds the ai_import entitlement", async () => {
    vi.mocked(auth).mockResolvedValue({
      userId: "user_1",
      sessionClaims: { org_public_metadata: { entitlements: ["ai_import"] } },
    } as never);
    firmsRow.mockReturnValue([{ aiImportsUsed: 99 }]);

    // No files in the import → route returns 400, proving we passed the gate
    // without reaching extractDocument. (Files lookup isn't mocked to return
    // rows; the gate is what we assert here.)
    const res = await POST(makeReq(), params);
    expect(res.status).not.toBe(402);
  });
});

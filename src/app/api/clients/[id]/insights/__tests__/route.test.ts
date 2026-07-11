import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db-helpers", () => ({ requireOrgId: vi.fn() }));
vi.mock("@/lib/clients/authz", () => ({ verifyClientAccess: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  checkExtractRateLimit: vi.fn(),
  rateLimitErrorResponse: vi.fn(() => new Response("rl", { status: 429 })),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/insights/battery", () => ({ loadInsightsBattery: vi.fn() }));
vi.mock("@/lib/insights/generate", () => ({ generateInsights: vi.fn() }));
vi.mock("@/lib/insights/persist", () => ({ saveInsightProfile: vi.fn() }));
vi.mock("@/lib/insights/hash", () => ({ hashBattery: vi.fn(() => "hash1") }));

import { POST } from "../route";
import { requireOrgId } from "@/lib/db-helpers";
import { verifyClientAccess } from "@/lib/clients/authz";

const req = () => new Request("http://x", { method: "POST", body: "{}" });
const ctx = { params: Promise.resolve({ id: "c1" }) };

beforeEach(() => vi.clearAllMocks());

describe("POST /insights", () => {
  it("404s when the caller lacks client access", async () => {
    vi.mocked(requireOrgId).mockResolvedValue("org1");
    vi.mocked(verifyClientAccess).mockResolvedValue({ ok: false } as never);
    const res = await POST(req() as never, ctx as never);
    expect(res.status).toBe(404);
  });
});

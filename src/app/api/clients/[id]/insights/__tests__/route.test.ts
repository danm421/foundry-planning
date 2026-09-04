import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/authz", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authz")>();
  return { ...actual, requireActiveSubscriptionForFirm: vi.fn().mockResolvedValue(undefined) };
});

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
vi.mock("@/lib/insights/persist", () => ({ loadInsightProfile: vi.fn(), saveInsightProfile: vi.fn() }));
vi.mock("@/lib/insights/hash", () => ({ hashBattery: vi.fn(() => "hash1") }));

import { GET, POST } from "../route";
import { auth } from "@clerk/nextjs/server";
import { requireOrgId } from "@/lib/db-helpers";
import { verifyClientAccess } from "@/lib/clients/authz";
import { checkExtractRateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { loadInsightsBattery } from "@/lib/insights/battery";
import { generateInsights } from "@/lib/insights/generate";
import { loadInsightProfile, saveInsightProfile } from "@/lib/insights/persist";
import { hashBattery } from "@/lib/insights/hash";

const req = () => new Request("http://x", { method: "POST", body: "{}" });
const ctx = { params: Promise.resolve({ id: "c1" }) };

beforeEach(() => vi.clearAllMocks());

describe("POST /insights", () => {
  it("404s when the caller lacks client access", async () => {
    vi.mocked(requireOrgId).mockResolvedValue("org1");
    vi.mocked(verifyClientAccess).mockResolvedValue({ ok: false } as never);
    const res = await POST(req() as never, ctx as never);
    expect(res.status).toBe(404);
    expect(vi.mocked(generateInsights)).not.toHaveBeenCalled();
  });

  it("404s when the caller has only view access", async () => {
    vi.mocked(requireOrgId).mockResolvedValue("org1");
    vi.mocked(verifyClientAccess).mockResolvedValue({
      ok: true,
      permission: "view",
      firmId: "f1",
      access: "shared",
    } as never);
    const res = await POST(req() as never, ctx as never);
    expect(res.status).toBe(404);
    expect(vi.mocked(generateInsights)).not.toHaveBeenCalled();
    expect(vi.mocked(saveInsightProfile)).not.toHaveBeenCalled();
  });

  // Guards the audit trail: the metadata records how many signals the model
  // was handed, so a review of the audit log shows what the AI generation was
  // grounded in. Asserts on the recorded value directly (not
  // `toHaveBeenCalledWith`, which silently drops undefined keys and would let
  // a missing `signalCount` pass unnoticed).
  it("audits the signal count from the battery", async () => {
    vi.mocked(requireOrgId).mockResolvedValue("org1");
    vi.mocked(verifyClientAccess).mockResolvedValue({
      ok: true,
      permission: "edit",
      firmId: "f1",
      access: "own",
    } as never);
    vi.mocked(checkExtractRateLimit).mockResolvedValue({
      allowed: true,
      remaining: 1,
      reset: 0,
    } as never);
    vi.mocked(loadInsightsBattery).mockResolvedValue({
      risk: { verdict: "aligned" },
      signals: [{ id: "risk.review_due" }, { id: "tax.qcd" }, { id: "portfolio.cash_drag" }],
    } as never);
    vi.mocked(auth).mockResolvedValue({ userId: "u1" } as never);
    vi.mocked(generateInsights).mockResolvedValue({
      sections: { headline: "h", snapshot: "s", goals: "g", actions: [], talkingPoints: [] },
      generatedAt: "2026-01-01T00:00:00.000Z",
    } as never);

    await POST(req() as never, ctx as never);

    expect(vi.mocked(recordAudit)).toHaveBeenCalledTimes(1);
    const call = vi.mocked(recordAudit).mock.calls[0][0] as { metadata: Record<string, unknown> };
    expect(call.metadata.signalCount).toBe(3);
  });
});

describe("GET /insights", () => {
  it("serves signals and the persisted headline/actions/talkingPoints, not needsAttention", async () => {
    vi.mocked(requireOrgId).mockResolvedValue("org1");
    vi.mocked(verifyClientAccess).mockResolvedValue({
      ok: true,
      permission: "view",
      firmId: "f1",
      access: "own",
    } as never);
    const signals = [{ id: "risk.review_due" }, { id: "tax.qcd" }];
    vi.mocked(loadInsightsBattery).mockResolvedValue({
      kpis: { netWorth: 1 },
      risk: { verdict: "aligned" },
      // Distinctive on purpose: 37 matches no other number in this fixture, so
      // the assertion below cannot pass by reading the wrong field.
      toleranceScore: 37,
      signals,
    } as never);
    vi.mocked(loadInsightProfile).mockResolvedValue({
      headline: "Cooper household is on track",
      snapshot: "snap",
      goals: "goals",
      opportunities: "old text, unread",
      actions: [{ signalId: "risk.review_due", recommendation: "r", why: "w" }],
      talkingPoints: ["tp1"],
      inputHash: "hash1",
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    } as never);

    const res = await GET(new Request("http://x") as never, ctx as never);
    const body = await res.json();

    expect(body.signals).toEqual(signals);
    expect(body.profile.headline).toBe("Cooper household is on track");
    expect(body.profile.actions).toEqual([
      { signalId: "risk.review_due", recommendation: "r", why: "w" },
    ]);
    expect(body.profile.talkingPoints).toEqual(["tp1"]);
    expect("needsAttention" in body).toBe(false);
    // kpis and risk are worse than a missing marker: insights-tab reads
    // view.kpis.netWorth and risk-alignment-scale indexes VERDICT_BADGE_CLASS by
    // risk.verdict, so dropping either throws and the whole 360 renders nothing.
    // `stale` drives the "plan data changed" nudge and the Refresh affordance.
    expect(body.kpis).toEqual({ netWorth: 1 });
    expect(body.risk).toEqual({ verdict: "aligned" });
    expect(body.stale).toBe(false);
    // The tolerance rung is the ONLY source for the 360 scale's fourth marker.
    // Asserting the value (not just presence) also catches a transposed field —
    // wiring this to kpis.netWorth or risk would yield 1 or undefined, not 37.
    expect(body.toleranceScore).toBe(37);
  });

  // Paired with the `stale: false` case above so the flag has to TRACK the
  // comparison. A single case would pass just as well against a hardcoded
  // constant, which is what the whole staleness chain hangs on.
  it("reports stale when the battery hash has moved away from the persisted one", async () => {
    vi.mocked(requireOrgId).mockResolvedValue("org1");
    vi.mocked(verifyClientAccess).mockResolvedValue({
      ok: true,
      permission: "view",
      firmId: "f1",
      access: "own",
    } as never);
    vi.mocked(loadInsightsBattery).mockResolvedValue({
      kpis: { netWorth: 1 },
      risk: { verdict: "aligned" },
      toleranceScore: 37,
      signals: [],
    } as never);
    // Once, not permanently: vi.clearAllMocks() clears calls but keeps
    // implementations, so a persistent override would leak into later tests.
    vi.mocked(hashBattery).mockReturnValueOnce("hash2");
    vi.mocked(loadInsightProfile).mockResolvedValue({
      headline: "h",
      snapshot: "s",
      goals: "g",
      actions: [],
      talkingPoints: [],
      inputHash: "hash1",
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    } as never);

    const res = await GET(new Request("http://x") as never, ctx as never);
    expect((await res.json()).stale).toBe(true);
  });
});

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { formatZodIssues } from "@/lib/schemas/common";
import { requireOrgId } from "@/lib/db-helpers";
import { verifyClientAccess } from "@/lib/clients/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { authErrorResponse } from "@/lib/authz";
import { checkExtractRateLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { auth } from "@clerk/nextjs/server";
import { loadInsightsBattery } from "@/lib/insights/battery";
import { hashBattery } from "@/lib/insights/hash";
import { generateInsights } from "@/lib/insights/generate";
import { loadInsightProfile, saveInsightProfile } from "@/lib/insights/persist";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.object({ force: z.boolean().default(false) });

/**
 * Read the 360 view — KPIs, risk alignment, needs-attention, and any persisted
 * AI prose plus its staleness flag. Powers the CRM household "360 AI" tab, which
 * fetches this lazily on tab-open so the heavy battery compute (overview
 * projection + Monte Carlo) never runs on a plain household page view.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireOrgId();
    const { id } = await params;

    const access = await verifyClientAccess(id);
    if (!access.ok) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const battery = await loadInsightsBattery(id, access.firmId);
    const inputHash = hashBattery(battery);
    const profile = await loadInsightProfile(id);
    const stale = !profile || profile.inputHash !== inputHash;

    return NextResponse.json({
      kpis: battery.kpis,
      risk: battery.risk,
      needsAttention: battery.needsAttention,
      stale,
      profile: profile
        ? {
            snapshot: profile.snapshot,
            goals: profile.goals,
            opportunities: profile.opportunities,
            generatedAt: profile.updatedAt.toISOString(),
          }
        : null,
    });
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("GET clients/[id]/insights", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const callerOrg = await requireOrgId();
    const { id } = await params;

    const access = await verifyClientAccess(id);
    if (!access.ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (access.permission !== "edit") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const parsed = Body.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", issues: formatZodIssues(parsed.error) },
        { status: 400 },
      );
    }

    const rl = await checkExtractRateLimit(callerOrg);
    if (!rl.allowed) return rateLimitErrorResponse(rl, "AI analysis rate limit exceeded");

    const battery = await loadInsightsBattery(id, access.firmId);
    const inputHash = hashBattery(battery);
    const { userId } = await auth();
    const { sections, generatedAt, cached } = await generateInsights({
      clientId: id,
      battery,
      force: parsed.data.force,
    });
    await saveInsightProfile({
      clientId: id,
      sections,
      inputHash,
      model: "gpt-5.4",
      userId: userId ?? "",
    });

    await recordAudit({
      action: "comparison.ai_generate",
      resourceType: "client",
      resourceId: id,
      clientId: id,
      firmId: access.firmId,
      metadata: crossFirmAuditMeta({ access: access.access }, callerOrg, {
        surface: "insights.360",
        force: parsed.data.force,
        cached,
        verdict: battery.risk.verdict,
      }),
    });

    return NextResponse.json({ sections, generatedAt, cached, inputHash });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", issues: formatZodIssues(err) },
        { status: 400 },
      );
    }
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("POST clients/[id]/insights", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

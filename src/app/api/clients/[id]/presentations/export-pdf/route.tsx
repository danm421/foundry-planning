import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { renderToStream } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import { resolveBranding } from "@/lib/comparison-pdf/branding";
import { foundryDefaultLogoDataUrl } from "@/lib/presentations/default-logo";
import {
  checkExportPdfRateLimit,
  rateLimitErrorResponse,
} from "@/lib/rate-limit";
import {
  ClientNotFoundError,
  ProjectionInputError,
} from "@/lib/projection/load-client-data";
import {
  loadEffectiveTreeForRef,
  type ScenarioRef,
} from "@/lib/scenario/loader";
import { runProjectionWithEvents } from "@/engine/projection";
import { loadMonteCarloData } from "@/lib/projection/load-monte-carlo-data";
import {
  runMonteCarlo,
  summarizeMonteCarlo,
  createReturnEngine,
  liquidPortfolioTotal,
} from "@/engine";
import { buildHistogramSeries } from "@/lib/monte-carlo/histogram-series";
import { successByYear } from "@/lib/comparison/success-by-year";
import type { MonteCarloReportPayload } from "@/lib/presentations/pages/monte-carlo/view-model";
import { PresentationDocument } from "@/components/presentations/document";
import {
  PRESENTATION_PAGES,
  type PresentationPageId,
} from "@/components/presentations/registry";
import { dateLong } from "@/lib/presentations/format";
import { recordAudit } from "@/lib/audit";
import { loadInvestmentsBundle } from "@/lib/presentations/investments-bundle";
import { loadScenarioChanges, loadScenarioToggleGroups } from "@/lib/scenario/changes";
import { buildTargetNames } from "@/lib/scenario/load-panel-data";
import type { ScenarioChangesContext } from "@/lib/presentations/pages/scenario-changes/types";
import React from "react";

export const dynamic = "force-dynamic";
// Defense-in-depth on top of the 25 s render-timeout race below: cap the
// whole route well below Vercel's default (300 s) so a pathological
// projection can't pin a function instance for minutes.
export const maxDuration = 60;

const PAGE_IDS = Object.keys(PRESENTATION_PAGES) as [
  PresentationPageId,
  ...PresentationPageId[],
];

// Per-pageId descriptor: options is validated against the page's
// registered optionsSchema, plus an optional scenarioOverride label.
// With only one registered page today, this collapses to a single object
// schema; when a 2nd page lands it auto-promotes to a discriminatedUnion.
const descriptorVariants = PAGE_IDS.map((pid) =>
  z.object({
    pageId: z.literal(pid),
    options: PRESENTATION_PAGES[pid].optionsSchema,
    scenarioOverride: z.string().nullable().optional(),
  }),
);
const pageDescriptorSchema =
  descriptorVariants.length === 1
    ? descriptorVariants[0]
    : z.discriminatedUnion(
        "pageId",
        descriptorVariants as unknown as [
          (typeof descriptorVariants)[number],
          ...(typeof descriptorVariants)[number][],
        ],
      );

const BodySchema = z.object({
  scenarioId: z.string().nullable().default(null),
  filename: z.string().trim().min(1).max(120).optional(),
  pages: z.array(pageDescriptorSchema).min(1),
});

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "");

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const firmId = await requireOrgId();

    const rl = await checkExportPdfRateLimit(firmId);
    if (!rl.allowed) {
      return rateLimitErrorResponse(
        rl,
        "Too many PDF exports. Please wait a moment and try again.",
      );
    }

    const { id } = await params;

    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", issues: parsed.error.issues },
        { status: 400 },
      );
    }

    // F15: resolve the scenarioId into a ScenarioRef so the effective tree
    // carries real scenario changes instead of always projecting base-case data.
    //   snap:<id> → frozen snapshot · <uuid> → live scenario · null|"base" → base
    const rawScenarioId = parsed.data.scenarioId;
    const scenarioRef: ScenarioRef = rawScenarioId?.startsWith("snap:")
      ? { kind: "snapshot", id: rawScenarioId.slice("snap:".length), side: "left" }
      : rawScenarioId && rawScenarioId !== "base"
        ? { kind: "scenario", id: rawScenarioId, toggleState: {} }
        : { kind: "scenario", id: "base", toggleState: {} };

    let clientData;
    try {
      const { effectiveTree } = await loadEffectiveTreeForRef(id, firmId, scenarioRef);
      clientData = effectiveTree;
    } catch (err) {
      if (err instanceof ClientNotFoundError) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      if (err instanceof ProjectionInputError) {
        // The raw message embeds internal client / CRM-household UUIDs (audit
        // F4). Keep the detail server-side; return a generic message.
        console.error(
          "POST /clients/[id]/presentations/export-pdf projection input error",
          err,
        );
        return NextResponse.json(
          { error: "Client data is incomplete or invalid for this projection." },
          { status: 422 },
        );
      }
      throw err;
    }

    const projection = runProjectionWithEvents(clientData);

    // Monte Carlo runs server-side only when the deck includes the MC page.
    // The engine is pure/Node-safe; we reuse the persisted base-case seed so
    // the PDF is reproducible. Scenario override is label-only (V1), so a
    // single payload covers the whole deck — mirrors the shared `projection`.
    let monteCarlo: MonteCarloReportPayload | null = null;
    if (parsed.data.pages.some((p) => p.pageId === "monteCarlo")) {
      try {
        const mc = await loadMonteCarloData(id, firmId);
        const engine = createReturnEngine({
          indices: mc.indices,
          correlation: mc.correlation,
          seed: mc.seed,
        });
        const accountMixes = new Map(mc.accountMixes.map((a) => [a.accountId, a.mix]));
        const result = await runMonteCarlo({
          data: clientData,
          returnEngine: engine,
          accountMixes,
          trials: 1000,
          requiredMinimumAssetLevel: mc.requiredMinimumAssetLevel,
        });
        const summary = summarizeMonteCarlo(result, {
          client: clientData.client,
          planSettings: clientData.planSettings,
          startingLiquidBalance: mc.startingLiquidBalance,
        });
        monteCarlo = {
          summary,
          histogram: buildHistogramSeries(result.endingLiquidAssets),
          successRates: successByYear(
            result.byYearLiquidAssetsPerTrial,
            mc.requiredMinimumAssetLevel,
          ),
          deterministic: projection.years.map(liquidPortfolioTotal),
        };
      } catch (mcErr) {
        // Non-fatal: leave monteCarlo null so the page renders its graceful
        // "data unavailable" frame instead of failing the whole export.
        console.error("Monte Carlo server-side run failed for export", mcErr);
      }
    }

    // Conditionally load the investments bundle — only when the deck includes
    // at least one investment page, to avoid unnecessary DB queries.
    const needsInvestments = parsed.data.pages.some(
      (p) => p.pageId === "assetAllocation" || p.pageId === "portfolioAnalysis",
    );
    const investments = needsInvestments
      ? (await loadInvestmentsBundle(id, firmId)) ?? undefined
      : undefined;

    // Scenario Changes report: load the raw edits for the active scenario, but
    // only when the deck includes that page AND the active ref is a live
    // scenario (not base / snapshot). loadScenarioChanges returns enabled rows
    // only — matching what the overlaid clientData already reflects.
    //
    // Org-scoping note: loadScenarioChanges/loadScenarioToggleGroups read by
    // scenarioId alone. rawScenarioId is proven to belong to this firm/client by
    // the earlier loadEffectiveTreeForRef() call (it loads the scenario scoped to
    // clientId/firmId and throws on a cross-org id before we reach here). Do not
    // remove or lazily defer that call without adding firm scoping to these reads.
    let scenarioChanges: ScenarioChangesContext | undefined;
    const needsScenarioChanges = parsed.data.pages.some((p) => p.pageId === "scenarioChanges");
    const isLiveScenario =
      !!rawScenarioId && rawScenarioId !== "base" && !rawScenarioId.startsWith("snap:");
    if (needsScenarioChanges && isLiveScenario) {
      try {
        const [changes, toggleGroups] = await Promise.all([
          loadScenarioChanges(rawScenarioId),
          loadScenarioToggleGroups(rawScenarioId),
        ]);
        scenarioChanges = {
          changes,
          toggleGroups,
          targetNames: buildTargetNames(clientData, id),
          baseLabel: "your current plan",
        };
      } catch (scErr) {
        // Non-fatal: leave undefined so the page renders its empty state.
        console.error("Scenario changes load failed for export", scErr);
      }
    }

    const ci = clientData.client;
    const clientFirstName = ci.firstName;
    const clientLastName = ci.lastName ?? "";
    const spouseFirstName = ci.spouseName ?? null;
    const clientFullName = `${clientFirstName} ${clientLastName}`.trim();

    // Human-readable label. Snapshot/UUID ids remain raw tokens here (V1);
    // a future pass can join the scenarios table for the real name.
    const scenarioLabel =
      rawScenarioId && rawScenarioId !== "base" ? rawScenarioId : "Base Case";

    // Firm branding for the cover: name, accent color, and logo. Falls back to
    // the Foundry mark + gold when the firm hasn't set their own.
    const branding = await resolveBranding(firmId);
    const firmName = branding.firmName;
    const firmLogoDataUrl = branding.logoDataUrl ?? (await foundryDefaultLogoDataUrl());

    // Cast required: renderToStream expects ReactElement<DocumentProps> but
    // createElement infers ReactElement<PresentationDocumentProps>. The element
    // is valid at runtime — PresentationDocument wraps react-pdf's <Document>.
    const doc = React.createElement(PresentationDocument, {
      pages: parsed.data.pages.map((p) => ({
        pageId: p.pageId,
        options: p.options as unknown as Record<string, unknown>,
        // V1 label-only override: a string becomes the per-page scenario
        // label; null/undefined fall through to the top-level scenarioLabel.
        scenarioOverrideLabel:
          typeof p.scenarioOverride === "string" ? p.scenarioOverride : null,
      })),
      firmName,
      firmTagline: null,
      firmLogoDataUrl,
      accentColor: branding.primaryColor,
      clientName: clientFullName,
      reportDate: dateLong(new Date()),
      scenarioLabel,
      spouseName: spouseFirstName,
      years: projection.years,
      projection,
      clientData,
      monteCarlo,
      investments,
      scenarioChanges,
    }) as unknown as React.ReactElement<DocumentProps>;

    // @react-pdf/renderer has a memory-leak history on large docs, and
    // a malformed doc could send it into an unbounded paginate loop.
    // Race the render against a 25 s timeout so a pathological PDF can
    // never pin the serverless function to its maxDuration.
    const stream = await Promise.race<
      Awaited<ReturnType<typeof renderToStream>>
    >([
      renderToStream(doc),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("PDF render timed out")), 25_000),
      ),
    ]);

    const filename = parsed.data.filename
      ? parsed.data.filename
      : `${slugify(clientLastName) || "client"}-presentation.pdf`;

    await recordAudit({
      action: "presentations.export_pdf",
      resourceType: "client",
      resourceId: id,
      clientId: id,
      firmId,
      metadata: {
        pages: parsed.data.pages.map((p) => p.pageId),
        scenarioId: parsed.data.scenarioId,
        hasOverrides: parsed.data.pages.some(
          (p) => p.scenarioOverride !== undefined,
        ),
      },
    });

    return new NextResponse(stream as unknown as ReadableStream, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (
      err instanceof UnauthorizedError ||
      (err instanceof Error && err.name === "UnauthorizedError")
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /clients/[id]/presentations/export-pdf failed", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { renderToStream } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { scenarios, scenarioSnapshots } from "@/db/schema";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import { resolveBranding } from "@/lib/comparison-pdf/branding";
import { foundryDefaultLogoDataUrl } from "@/lib/presentations/default-logo";
import {
  checkExportPdfRateLimit,
  checkPreviewPdfRateLimit,
  rateLimitErrorResponse,
} from "@/lib/rate-limit";
import {
  ClientNotFoundError,
  ProjectionInputError,
} from "@/lib/projection/load-client-data";
import { loadEffectiveTreeForRef } from "@/lib/scenario/loader";
import { runProjectionWithEvents } from "@/engine/projection";
import { loadMonteCarloData } from "@/lib/projection/load-monte-carlo-data";
import {
  runMonteCarlo,
  createReturnEngine,
} from "@/engine";
import type { MonteCarloReportPayload } from "@/lib/presentations/pages/monte-carlo/view-model";
import { buildMonteCarloReportPayload } from "@/lib/presentations/pages/monte-carlo/build-payload";
import {
  PresentationDocument,
  type PageScenarioBundle,
} from "@/components/presentations/document";
import {
  PRESENTATION_PAGES,
  type PresentationPageId,
} from "@/components/presentations/registry";
import { dateLong } from "@/lib/presentations/format";
import { recordAudit } from "@/lib/audit";
import { loadInvestmentsBundle } from "@/lib/presentations/investments-bundle";
import { loadLifeInsuranceInventory } from "@/lib/insurance-policies/load-li-inventory";
import { loadScenarioChanges, loadScenarioToggleGroups } from "@/lib/scenario/changes";
import { buildTargetNames } from "@/lib/scenario/load-panel-data";
import type { ScenarioChangesContext } from "@/lib/presentations/pages/scenario-changes/types";
import {
  planScenarioBundles,
  labelForRef,
  type PlannerPage,
} from "@/lib/scenario/presentation-refs";
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
  preview: z.boolean().optional().default(false),
  pages: z.array(pageDescriptorSchema).min(1),
});

// Guardrails: cap the work a single export can fan out to, so a deck with
// many per-page scenario overrides can't blow the 25 s render / 60 s function
// budget. Exceeding either returns 400 instead of timing out.
const MAX_DISTINCT_SCENARIOS = 6;
const MAX_MC_SCENARIOS = 3;

// Pages that require a server-side Monte Carlo run for their scenario. The MC
// page renders the full simulation; the Retirement Summary needs it only for its
// Monte Carlo KPI. Runs are deduped per distinct scenario in planScenarioBundles.
const MONTE_CARLO_PAGE_IDS = new Set<string>(["monteCarlo", "retirementSummary"]);

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

    const isPreview = parsed.data.preview;
    const rl = isPreview
      ? await checkPreviewPdfRateLimit(firmId)
      : await checkExportPdfRateLimit(firmId);
    if (!rl.allowed) {
      return rateLimitErrorResponse(
        rl,
        isPreview
          ? "Too many previews. Please wait a moment and try again."
          : "Too many PDF exports. Please wait a moment and try again.",
      );
    }

    // Plan the distinct set of scenarios this deck needs. Pages that don't
    // support an override, or whose override is undefined ("Default"), follow
    // the top-level scenario.
    const plannerPages: PlannerPage[] = parsed.data.pages.map((p) => ({
      supportsScenarioOverride: PRESENTATION_PAGES[p.pageId].supportsScenarioOverride,
      scenarioOverride: p.scenarioOverride,
      needsMonteCarloRun: MONTE_CARLO_PAGE_IDS.has(p.pageId),
      isScenarioChanges: p.pageId === "scenarioChanges",
    }));
    const plan = planScenarioBundles(plannerPages, parsed.data.scenarioId);

    if (plan.distinct.size > MAX_DISTINCT_SCENARIOS) {
      return NextResponse.json(
        {
          error: `Too many distinct scenarios in one deck (${plan.distinct.size}). Limit is ${MAX_DISTINCT_SCENARIOS}.`,
        },
        { status: 400 },
      );
    }
    const mcCount = [...plan.distinct.values()].filter((d) => d.needsMonteCarlo).length;
    if (mcCount > MAX_MC_SCENARIOS) {
      return NextResponse.json(
        {
          error: `Too many scenarios with a Monte Carlo page (${mcCount}). Limit is ${MAX_MC_SCENARIOS}.`,
        },
        { status: 400 },
      );
    }

    // Resolve human-readable names for every live scenario / snapshot id in the
    // plan, in two batched queries. firmId scoping is enforced per-tree below by
    // loadEffectiveTreeForRef (it throws on a cross-org id before we use names).
    const liveScenarioIds: string[] = [];
    const snapshotIds: string[] = [];
    for (const { ref } of plan.distinct.values()) {
      if (ref.kind === "snapshot") snapshotIds.push(ref.id);
      else if (ref.id !== "base") liveScenarioIds.push(ref.id);
    }

    const scenarioNames = new Map<string, string>();
    if (liveScenarioIds.length > 0) {
      const rows = await db
        .select({ id: scenarios.id, name: scenarios.name })
        .from(scenarios)
        .where(inArray(scenarios.id, liveScenarioIds));
      for (const r of rows) scenarioNames.set(r.id, r.name);
    }
    if (snapshotIds.length > 0) {
      const rows = await db
        .select({ id: scenarioSnapshots.id, name: scenarioSnapshots.name })
        .from(scenarioSnapshots)
        .where(inArray(scenarioSnapshots.id, snapshotIds));
      for (const r of rows) scenarioNames.set(r.id, r.name);
    }
    // Conditionally load the investments bundle — only when the deck includes
    // at least one investment page, to avoid unnecessary DB queries.
    const needsInvestments = parsed.data.pages.some(
      (p) => p.pageId === "assetAllocation" || p.pageId === "portfolioAnalysis",
    );
    const investments = needsInvestments
      ? (await loadInvestmentsBundle(id, firmId)) ?? undefined
      : undefined;

    // Build one bundle per distinct scenario. Projection always; Monte Carlo
    // and scenario-changes only where the plan says a page needs them.
    const bundles: Record<string, PageScenarioBundle> = {};
    for (const [key, d] of plan.distinct) {
      let clientData;
      try {
        const { effectiveTree } = await loadEffectiveTreeForRef(id, firmId, d.ref);
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
      // The engine is pure/Node-safe. Each scenario uses its own persisted seed
      // (snapshots fall back to the base seed) so the PDF is reproducible per
      // scenario. The effective tree for this bundle drives startingLiquidBalance.
      let monteCarlo: MonteCarloReportPayload | null = null;
      if (d.needsMonteCarlo) {
        try {
          const mc = await loadMonteCarloData(
            id,
            firmId,
            // Layer 1: per-scenario MC seed + per-scenario cache() key. Snapshots
            // have no live scenario row, so they fall back to the base seed.
            d.ref.kind === "scenario" ? d.ref.id : "base",
            [],
            // Layer 2 (Depth 1): per-scenario startingLiquidBalance from this
            // bundle's effective tree.
            clientData,
          );
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
          monteCarlo = buildMonteCarloReportPayload({
            result,
            projection,
            mcPayload: mc,
            clientData,
          });
        } catch (mcErr) {
          // Non-fatal: leave monteCarlo null so the page renders its graceful
          // "data unavailable" frame instead of failing the whole export.
          console.error("Monte Carlo server-side run failed for export", mcErr);
        }
      }

      // Scenario Changes report: load the raw edits for the active scenario, but
      // only when the deck includes that page AND the active ref is a live
      // scenario (not base / snapshot). loadScenarioChanges returns enabled rows
      // only — matching what the overlaid clientData already reflects.
      //
      // Org-scoping note: loadScenarioChanges/loadScenarioToggleGroups read by
      // scenarioId alone. The scenarioId is proven to belong to this firm/client by
      // the earlier loadEffectiveTreeForRef() call (it loads the scenario scoped to
      // clientId/firmId and throws on a cross-org id before we reach here). Do not
      // remove or lazily defer that call without adding firm scoping to these reads.
      let scenarioChanges: ScenarioChangesContext | undefined;
      if (d.needsScenarioChanges && d.ref.kind === "scenario") {
        const scenarioId = d.ref.id;
        try {
          const [changes, toggleGroups] = await Promise.all([
            loadScenarioChanges(scenarioId),
            loadScenarioToggleGroups(scenarioId),
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

      bundles[key] = {
        clientData,
        projection,
        scenarioLabel: labelForRef(d.ref, scenarioNames),
        monteCarlo,
        scenarioChanges,
      };
    }

    // The cover/client-name fields come from the top-level bundle.
    const topBundle = bundles[plan.topKey];
    const ci = topBundle.clientData.client;
    const clientLastName = ci.lastName ?? "";
    const spouseFirstName = ci.spouseName ?? null;
    const clientFullName = `${ci.firstName} ${clientLastName}`.trim();

    // Conditionally load the life insurance inventory — only when the deck
    // includes the Life Insurance Summary page.
    const needsLifeInsurance = parsed.data.pages.some(
      (p) => p.pageId === "lifeInsuranceSummary",
    );
    const lifeInsurance = needsLifeInsurance
      ? await loadLifeInsuranceInventory(id, firmId, clientFullName, spouseFirstName)
      : undefined;

    // Firm branding for the cover: name, accent color, and logo. Falls back to
    // the Foundry mark + gold when the firm hasn't set their own.
    const branding = await resolveBranding(firmId);
    const firmName = branding.firmName;
    const firmLogoDataUrl = branding.logoDataUrl ?? (await foundryDefaultLogoDataUrl());

    // Cast required: renderToStream expects ReactElement<DocumentProps> but
    // createElement infers ReactElement<PresentationDocumentProps>. The element
    // is valid at runtime — PresentationDocument wraps react-pdf's <Document>.
    const doc = React.createElement(PresentationDocument, {
      pages: parsed.data.pages.map((p, idx) => ({
        pageId: p.pageId,
        options: p.options as unknown as Record<string, unknown>,
        scenarioKey: plan.pageKeys[idx],
      })),
      firmName,
      firmTagline: null,
      firmLogoDataUrl,
      accentColor: branding.primaryColor,
      clientName: clientFullName,
      reportDate: dateLong(new Date()),
      spouseName: spouseFirstName,
      bundles,
      topScenarioKey: plan.topKey,
      investments,
      lifeInsurance,
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
      action: isPreview ? "presentations.preview_pdf" : "presentations.export_pdf",
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
        distinctScenarioCount: plan.distinct.size,
      },
    });

    const safeFilename = filename.replace(/["\\\r\n;]/g, "");
    return new NextResponse(stream as unknown as ReadableStream, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${isPreview ? "inline" : "attachment"}; filename="${safeFilename}"`,
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

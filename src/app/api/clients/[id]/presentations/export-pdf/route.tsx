import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { renderToStream } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { firms } from "@/db/schema";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import {
  loadClientData,
  ClientNotFoundError,
  ProjectionInputError,
} from "@/lib/projection/load-client-data";
import { runProjectionWithEvents } from "@/engine/projection";
import { PresentationDocument } from "@/components/presentations/document";
import {
  PRESENTATION_PAGES,
  type PresentationPageId,
} from "@/components/presentations/registry";
import { dateLong } from "@/lib/presentations/format";
import { recordAudit } from "@/lib/audit";
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

    let clientData;
    try {
      clientData = await loadClientData(id, firmId);
    } catch (err) {
      if (err instanceof ClientNotFoundError) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      if (err instanceof ProjectionInputError) {
        return NextResponse.json({ error: err.message }, { status: 422 });
      }
      throw err;
    }

    const projection = runProjectionWithEvents(clientData);

    const ci = clientData.client;
    const clientFirstName = ci.firstName;
    const clientLastName = ci.lastName ?? "";
    const spouseFirstName = ci.spouseName ?? null;
    const clientFullName = `${clientFirstName} ${clientLastName}`.trim();

    const scenarioLabel = parsed.data.scenarioId ?? "Base Case";

    const [firmRow] = await db
      .select({ displayName: firms.displayName })
      .from(firms)
      .where(eq(firms.firmId, firmId));
    const firmName = firmRow?.displayName ?? "Foundry Planning";

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
      clientName: clientFullName,
      reportDate: dateLong(new Date()),
      scenarioLabel,
      spouseName: spouseFirstName,
      years: projection.years,
      projection,
      clientData,
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

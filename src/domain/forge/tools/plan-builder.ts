// src/domain/forge/tools/plan-builder.ts
//
// Forge Plan Builder tools. `get_plan_status` is a read-only tool that
// reports where a plan-build stands for a pending import: its status, how
// many smart questions the assemble step still needs answered, and the
// review-surface link. Mirrors the read.ts idiom: re-derive firmId via
// requireOrgId(), gate with assertClientReadable(ctx, ctx.clientId), then
// scope the clientImports read to id + clientId + orgId + not-discarded.
import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { clientImports } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import type { ImportPayloadJson } from "@/lib/imports/types";
import { ensurePlanImport } from "@/lib/imports/plan-builder-core";
import { recordAudit } from "@/lib/audit";
import { emitToolRender } from "@/domain/forge/custom-events";
import type { ForgeToolContext } from "../context";
import { assertClientReadable } from "../guards";
import { gateAccess } from "./scenario-writes";

export function buildPlanBuilderTools(
  toolCtx: ForgeToolContext,
): StructuredToolInterface[] {
  const { ctx, conversationId } = toolCtx;

  const getPlanStatus = tool(
    async ({ importId }: { importId: string }) => {
      const firmId = await requireOrgId();
      await assertClientReadable(ctx, ctx.clientId);

      const [row] = await db
        .select({
          status: clientImports.status,
          payloadJson: clientImports.payloadJson,
        })
        .from(clientImports)
        .where(
          and(
            eq(clientImports.id, importId),
            eq(clientImports.clientId, ctx.clientId),
            eq(clientImports.orgId, firmId),
            isNull(clientImports.discardedAt),
          ),
        )
        .limit(1);

      if (!row) {
        return JSON.stringify({ error: "Import not found for this client." });
      }

      const assemble = (row.payloadJson as ImportPayloadJson | null)?.assemble;
      const questions = assemble?.questions ?? [];
      const unanswered = questions.filter((q) => !q.answer);
      const reviewPath = `/clients/${ctx.clientId}/details/import/${importId}`;

      return JSON.stringify({
        status: row.status,
        questionCount: questions.length,
        unanswered,
        reviewPath,
      });
    },
    {
      name: "get_plan_status",
      description:
        "Check where a Forge plan-build stands for a pending import: its status, the smart questions the assemble step still needs answered, and the link to the review screen. Read-only, scoped to the current client.",
      schema: z.object({
        importId: z.string().describe("The client import id whose plan-build status to check."),
      }),
    },
  );

  const buildPlan = tool(
    async () => {
      try {
        const gate = await gateAccess(ctx.clientId);
        if ("error" in gate) return gate.error;
        const { firmId } = gate;
        const { importId } = await ensurePlanImport({
          mode: "existing", firmId, actorUserId: ctx.userId,
          existing: { clientId: ctx.clientId },
        });
        await recordAudit({
          action: "forge.write_approved", resourceType: "client_import", resourceId: importId,
          clientId: ctx.clientId, firmId, actorId: ctx.userId,
          metadata: { tool: "build_plan", conversationId, mode: "existing" },
        });
        await emitToolRender("build_plan", "complete", { clientId: ctx.clientId, importId, mode: "existing" });
        return JSON.stringify({ clientId: ctx.clientId, importId, mode: "existing" });
      } catch {
        return "Sorry — that action couldn't be completed.";
      }
    },
    {
      name: "build_plan",
      description:
        "Start assembling a refreshed financial plan for the CURRENT client from documents the advisor will " +
        "upload (statements, tax returns). Creates a draft import to attach files to; after files land, the panel " +
        "runs extraction + assemble and surfaces a short list of smart questions. Requires human approval.",
      schema: z.object({}),
    },
  );

  return [getPlanStatus, buildPlan];
}

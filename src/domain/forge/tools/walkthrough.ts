// src/domain/forge/tools/walkthrough.ts
//
// GLOBAL guided-walkthrough tool. Read-only: it only emits a `walkthrough`
// custom event asking the client to start an on-screen coachmark tour. The
// model supplies a walkthroughId (from the walkthrough index / a get_help
// result), never a selector or URL. emitWalkthrough re-validates the id against
// the catalog. NOT a write tool — no HITL.
import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import type { ForgeGlobalToolContext } from "../context";
import { getWalkthrough } from "../help/catalog";
import { emitWalkthrough } from "../custom-events";

export function buildWalkthroughTools(_toolCtx: ForgeGlobalToolContext): StructuredToolInterface[] {
  const startWalkthrough = tool(
    async ({ walkthroughId }: { walkthroughId: string }) => {
      const w = getWalkthrough(walkthroughId);
      if (!w) return JSON.stringify({ error: "No such walkthrough." });
      try {
        await emitWalkthrough(walkthroughId); // re-validates + dispatches
      } catch {
        return JSON.stringify({ error: "Could not start that walkthrough." });
      }
      return JSON.stringify({ started: true, walkthroughId });
    },
    {
      name: "start_walkthrough",
      description:
        "Launch an on-screen guided walkthrough (a coachmark tour that spotlights the real buttons " +
        "and steps the advisor through a task). Pass a walkthroughId from the walkthrough index or a " +
        "get_help result. Only start a tour the advisor asked for or agreed to. Non-destructive.",
      schema: z.object({
        walkthroughId: z.string().min(1).describe("a walkthrough id from the catalog"),
      }),
    },
  );
  return [startWalkthrough];
}

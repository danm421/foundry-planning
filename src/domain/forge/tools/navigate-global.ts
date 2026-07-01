// src/domain/forge/tools/navigate-global.ts
//
// GLOBAL navigation tools. Unlike the client navigate tool (which builds
// /clients/<id>/... hrefs), these resolve their target from a curated help
// TOPIC — the model supplies a topicId, never a URL. The topic's href is
// re-validated by emitNavigate/emitPageLink against the allowlist (defence in
// depth).
import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import type { ForgeGlobalToolContext } from "../context";
import { getHelpTopic } from "../help/catalog";
import { emitNavigate, emitPageLink } from "../custom-events";

export function buildGlobalNavigateTools(_toolCtx: ForgeGlobalToolContext): StructuredToolInterface[] {
  const openPage = tool(
    async ({ topicId }: { topicId: string }) => {
      const t = getHelpTopic(topicId);
      if (!t) return JSON.stringify({ error: "Could not open that page." });
      try {
        await emitNavigate(t.href); // throws if not allowlisted
      } catch {
        return JSON.stringify({ error: "Could not open that page." });
      }
      return JSON.stringify({ navigated: true, topicId });
    },
    {
      name: "open_page",
      description:
        "Take the advisor to the in-app page for a help topic (by topicId) so they can do the task " +
        "themselves. Use when they ask to 'open', 'take me to', or 'go to' a section. Non-destructive.",
      schema: z.object({ topicId: z.string().min(1).describe("a help-catalog topic id") }),
    },
  );

  const citePage = tool(
    async ({ topicId }: { topicId: string }) => {
      const t = getHelpTopic(topicId);
      if (!t) return JSON.stringify({ error: "Could not attach that link." });
      try {
        await emitPageLink(t.href, t.id, t.title); // throws if not allowlisted
      } catch {
        return JSON.stringify({ error: "Could not attach that link." });
      }
      return JSON.stringify({ cited: true, topicId });
    },
    {
      name: "cite_page",
      description:
        "Attach a clickable deep-link (by help topicId) to your answer WITHOUT navigating there yourself. " +
        "Call this after answering a how-to question so the advisor can jump to the right page when ready.",
      schema: z.object({ topicId: z.string().min(1).describe("a help-catalog topic id") }),
    },
  );

  return [openPage, citePage];
}

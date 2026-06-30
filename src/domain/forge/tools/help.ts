// src/domain/forge/tools/help.ts
//
// Product-help tools (GLOBAL mode). Read-only: they answer "how do I / where do
// I go" questions from the curated catalog. No client scope, no mutations. The
// model picks a topic id; hrefs come from the catalog, never the model.
import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import type { ForgeGlobalToolContext } from "../context";
import { findHelpTopics, getHelpTopic } from "../help/catalog";

export function buildHelpTools(_toolCtx: ForgeGlobalToolContext): StructuredToolInterface[] {
  const searchHelp = tool(
    async ({ query }: { query: string }) => {
      const topics = findHelpTopics(query).map((t) => ({
        id: t.id,
        title: t.title,
        steps: t.steps,
        href: t.href,
        walkthroughId: t.walkthroughId,
      }));
      return JSON.stringify({ topics });
    },
    {
      name: "search_help",
      description:
        "Search the Foundry product-help catalog for how-to topics matching the advisor's " +
        "'how do I / where do I' question. Read-only. Returns matching topics with steps and " +
        "the in-app deep-link. Use this to answer questions about USING the app itself " +
        "(adding a household, importing a document, running Monte Carlo), not about a client's plan.",
      schema: z.object({ query: z.string().min(1).describe("the advisor's how-to question") }),
    },
  );

  const getHelp = tool(
    async ({ topicId }: { topicId: string }) => {
      const t = getHelpTopic(topicId);
      if (!t) return `Help topic "${topicId}" not found.`;
      return JSON.stringify({
        topic: { id: t.id, title: t.title, steps: t.steps, href: t.href, walkthroughId: t.walkthroughId },
      });
    },
    {
      name: "get_help",
      description:
        "Fetch the full how-to steps + deep-link for one product-help topic by its id " +
        "(from search_help or the topic index). Read-only. After answering, attach the deep-link " +
        "with cite_page so the advisor can jump to the right page.",
      schema: z.object({ topicId: z.string().min(1) }),
    },
  );

  return [searchHelp, getHelp];
}

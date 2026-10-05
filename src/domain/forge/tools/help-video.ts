// suggest_help_video — read-only, both client and global chat. Searches the
// Knowledge Hub's help videos and, on a strong match, attaches a ▶ Watch card
// to the answer. The model supplies only search words; the server picks the
// video from the reviewed details files, so it can never point the advisor at
// a video (or a URL) that doesn't exist. Not a write tool — no HITL.
import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import { HELP_VIDEOS } from "../help/videos";
import { isStrongMatch, searchHelpVideos } from "../help/video-search";
import { emitVideoLink } from "../custom-events";

const NONE = JSON.stringify({ suggested: null, note: "No help video matches — don't mention one." });

export function buildHelpVideoTools(): StructuredToolInterface[] {
  const suggest = tool(
    async ({ query }: { query: string }) => {
      // Hits are sorted by words matched, so the first strong one is the best
      // strong one — a weak hit ranked above it mustn't hide it.
      const top = searchHelpVideos(query, HELP_VIDEOS).find(isStrongMatch);
      if (!top) return NONE;
      try {
        await emitVideoLink(top.video.slug, top.chapter);
      } catch (err) {
        // Broken wiring, not "no match" — say so in the logs.
        console.warn("suggest_help_video: couldn't attach the Watch card", {
          slug: top.video.slug,
          error: err instanceof Error ? err.message : String(err),
        });
        return NONE;
      }
      return JSON.stringify({ suggested: { title: top.video.title, chapter: top.chapter?.label ?? null } });
    },
    {
      name: "suggest_help_video",
      description:
        "Find a short Foundry help video for a 'how do I…' question about USING the app " +
        "(adding an expense, saving Solver changes as a scenario). Pass the task in a few plain words. " +
        "On a good match the advisor gets a ▶ Watch card under your answer — point to it in one short line. " +
        "Read-only. Not for questions about a client's numbers.",
      schema: z.object({
        query: z.string().min(1).describe("the task in a few plain words, e.g. 'add a one-time expense'"),
      }),
    },
  );
  return [suggest];
}

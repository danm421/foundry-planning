// The chapter list, and everything the rest of the report needs to know about a
// chapter without importing it: its heading, the layout that prints it, the
// AI-off narrator, and the one line that tells the model what it is for.
import type { ChapterId, StoryContext } from "../types";
import { narratePlanInOnePage } from "./plan-in-one-page";
import { narrateWhatYouHave } from "./what-you-have";
import { narrateWhatWeRecommend } from "./what-we-recommend";

export type ChapterLayout = "heroProse" | "strategyCards";

export interface ChapterDef {
  id: ChapterId;
  /** Client-facing chapter heading. */
  title: string;
  layout: ChapterLayout;
  /** The AI-off fallback. Never returns an empty array for a valid context. */
  narrate: (ctx: StoryContext) => string[];
  /** Hidden when there is no proposed scenario. */
  requiresProposal: boolean;
  /** One line telling the model what this chapter is for. */
  brief: string;
}

export const CHAPTERS: Record<ChapterId, ChapterDef> = {
  planInOnePage: {
    id: "planInOnePage",
    title: "Your plan, in one page",
    layout: "heroProse",
    narrate: narratePlanInOnePage,
    requiresProposal: false,
    brief:
      "The punchline before the evidence. What the plan says, whether it holds up, and what moved it. This is the page that gets read when nothing else does.",
  },
  whatYouHave: {
    id: "whatYouHave",
    title: "What you have",
    layout: "heroProse",
    narrate: narrateWhatYouHave,
    requiresProposal: false,
    brief:
      "What they own, what they owe, and the difference — plus the honest note that not all of it is spendable.",
  },
  whatWeRecommend: {
    id: "whatWeRecommend",
    title: "What we're recommending, and why",
    layout: "strategyCards",
    narrate: narrateWhatWeRecommend,
    requiresProposal: true,
    brief:
      "Each strategy in turn: what we'd do, why it fits this household, and the mechanism by which it moves the numbers.",
  },
};

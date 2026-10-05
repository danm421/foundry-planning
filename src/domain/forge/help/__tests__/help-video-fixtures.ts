// src/domain/forge/help/__tests__/help-video-fixtures.ts
//
// Two realistic Knowledge Hub videos for tests. Mirrors the two launch videos
// (add-one-time-expense, solver-save-scenario) but with fake hashes.
import type { HelpVideo } from "../video-schema";

const sha = (c: string) => c.repeat(64);

export const EXPENSE_VIDEO: HelpVideo = {
  slug: "add-one-time-expense",
  title: "Add a one-time expense and see it in the cash flow",
  summary: "Add a cost that happens once, like a remodel, and find it in that year's cash flow.",
  screens: [
    { route: "/clients/:id/details/income-expenses", label: "Inflows & Outflows" },
    { route: "/clients/:id/cashflow", label: "Cash Flow" },
  ],
  tags: ["expenses", "cash-flow"],
  searchTerms: ["lump sum", "big purchase", "one-off cost", "remodel"],
  chapters: [
    { at: 0, label: "Mark and Laura plan an $80,000 kitchen remodel in 2028." },
    { at: 9.5, label: "Add it as an expense: choose Other and give it a name." },
    { at: 21, label: "Enter the cost in today's dollars. Foundry adds inflation." },
    { at: 30, label: "Set the start and end year to 2028, so it's paid once." },
    { at: 44, label: "Open Cash Flow to see the effect year by year." },
    { at: 58, label: "Drill into Expenses to see what's behind the jump." },
  ],
  steps: [
    "**Open Inflows & Outflows.** From a client's **Details**, choose **Inflows & Outflows**.",
    "**Add the expense.** In the **Expenses** panel, select **+ Add**. Set **Type** to **Other** and enter a **Name**.",
    "**Make it one year.** For **Start Year** and **End Year**, choose **Manual** and enter the same year in both.",
  ],
  goodToKnow: ["An amount in today's dollars grows with inflation until its year."],
  durationSec: 73.5,
  recordedOn: "2026-10-05",
  appCommit: "705a133c4",
  video: { path: `knowledge-hub/add-one-time-expense/${sha("a").slice(0, 12)}.mp4`, sha256: sha("a"), bytes: 6_160_000 },
  poster: { path: `knowledge-hub/add-one-time-expense/${sha("b").slice(0, 12)}.jpg`, sha256: sha("b") },
};

export const SOLVER_VIDEO: HelpVideo = {
  slug: "solver-save-scenario",
  title: "Try what-if changes in the Solver and save them as a scenario",
  summary: "Change retirement ages and spending live, watch Plan Confidence react, and keep the version you like.",
  screens: [{ route: "/clients/:id/solver", label: "Solver" }],
  tags: ["solver", "scenarios", "retirement"],
  searchTerms: ["what if", "save scenario", "plan confidence"],
  chapters: [
    { at: 0, label: "The Solver tries what-if changes and shows the impact right away." },
    { at: 8, label: "What if Mark and Laura both retire at 62 instead of 65?" },
    { at: 40, label: "Save these changes as a scenario and give it a name." },
    { at: 62, label: "Open the Scenario changes tab and pick the scenario." },
  ],
  steps: [
    "**Open the Solver.** From a client, choose **Solver** in the top bar.",
    "**Save it.** Select **Save as scenario…** and give it a name.",
  ],
  durationSec: 84.7,
  recordedOn: "2026-10-04",
  appCommit: "ab1cdbaf0",
  video: { path: `knowledge-hub/solver-save-scenario/${sha("c").slice(0, 12)}.mp4`, sha256: sha("c"), bytes: 6_290_000 },
  poster: { path: `knowledge-hub/solver-save-scenario/${sha("d").slice(0, 12)}.jpg`, sha256: sha("d") },
};

export function makeVideo(overrides: Partial<HelpVideo>): HelpVideo {
  return { ...EXPENSE_VIDEO, ...overrides };
}

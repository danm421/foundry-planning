// src/domain/forge/help/videos/index.ts
//
// The Knowledge Hub's videos. One JSON details file per video sits beside this
// file; the kb-video skill's publish step writes it, and a person adds its
// import here. JSON imports widen literal unions (tags) to string, so each
// entry is cast — videos.contract.test.ts proves every file matches HelpVideo,
// which makes the cast checked rather than hopeful.
import type { HelpVideo } from "../video-schema";
import addFirstHousehold from "./add-first-household.json";
import addOneTimeExpense from "./add-one-time-expense.json";
import addRothConversion from "./add-roth-conversion.json";
import readMonthlyCashFlow from "./read-monthly-cash-flow.json";
import sellHomeBuyWithMortgage from "./sell-home-buy-with-mortgage.json";
import solverSaveScenario from "./solver-save-scenario.json";

export const HELP_VIDEOS: readonly HelpVideo[] = [
  addFirstHousehold as HelpVideo,
  addOneTimeExpense as HelpVideo,
  addRothConversion as HelpVideo,
  readMonthlyCashFlow as HelpVideo,
  sellHomeBuyWithMortgage as HelpVideo,
  solverSaveScenario as HelpVideo,
];

export function getHelpVideo(slug: string): HelpVideo | undefined {
  return HELP_VIDEOS.find((v) => v.slug === slug);
}

// src/lib/insights/generate.ts
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { chatModel } from "@/domain/forge/llm";
import type { InsightsBattery } from "./battery";
import type { Signal } from "./signals";
import { buildInsightsPrompt } from "./prompt";
import { GeneratedInsightsSchema, type GeneratedInsights, type InsightAction } from "./schemas";

export type { GeneratedInsights, InsightAction } from "./schemas";

/**
 * How many actions the 360 tab shows. `actions` is the "what would you do
 * first" shortlist, not a second rendering of the signal list — the
 * deterministic SignalsList already shows every signal in full. 18 rules can
 * fire, and each action renders as signal title + recommendation + why, so an
 * uncapped list turns a triage queue into a wall of text.
 */
export const MAX_ACTIONS = 5;

/**
 * Keep only actions that cite a supplied signal, one per signal, up to
 * MAX_ACTIONS.
 *
 * This is the anti-fabrication control: the model can only recommend something
 * by attaching it to a signal id, and an id it invents is not in the input set.
 * Citing a REAL id repeatedly is the way around that, so duplicates are dropped
 * too — otherwise one genuine signal can be spun into a full page of invented
 * recommendations, every one of which passes the citation check.
 *
 * Order among survivors is the model's ranking and is preserved: the first
 * occurrence of each id wins and the list is truncated from the tail, so the
 * cap keeps the model's top picks rather than an arbitrary slice.
 */
export function dropUncitedActions(
  actions: InsightAction[],
  signals: Signal[],
): InsightAction[] {
  const known = new Set(signals.map((s) => s.id));
  const seen = new Set<string>();
  const kept: InsightAction[] = [];
  for (const a of actions) {
    if (kept.length >= MAX_ACTIONS) break;
    if (!known.has(a.signalId)) {
      console.warn(`[insights] dropped action citing unknown signal: ${a.signalId}`);
      continue;
    }
    if (seen.has(a.signalId)) {
      console.warn(`[insights] dropped duplicate action for signal: ${a.signalId}`);
      continue;
    }
    seen.add(a.signalId);
    kept.push(a);
  }
  return kept;
}

export async function generateInsights(args: {
  clientId: string;
  battery: InsightsBattery;
  force: boolean;
}): Promise<{ sections: GeneratedInsights; generatedAt: string; cached: boolean }> {
  const { system, user } = buildInsightsPrompt(args.battery);

  const model = chatModel("full").withStructuredOutput(GeneratedInsightsSchema, {
    name: "client_360_profile",
  });
  const raw = (await model.invoke([
    new SystemMessage(system),
    new HumanMessage(user),
  ])) as GeneratedInsights;

  const sections: GeneratedInsights = {
    ...raw,
    actions: dropUncitedActions(raw.actions, args.battery.signals),
  };

  return { sections, generatedAt: new Date().toISOString(), cached: false };
}

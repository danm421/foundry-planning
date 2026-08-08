// src/lib/insights/generate.ts
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { chatModel } from "@/domain/forge/llm";
import type { InsightsBattery } from "./battery";
import type { Signal } from "./signals";
import { buildInsightsPrompt } from "./prompt";
import { GeneratedInsightsSchema, type GeneratedInsights, type InsightAction } from "./schemas";

export type { GeneratedInsights, InsightAction } from "./schemas";

/**
 * Discard any action citing a signal that was never supplied.
 *
 * This is the anti-fabrication control: the model can only recommend something
 * by attaching it to a signal id, and an id it invents is not in the input set.
 * Order among survivors is the model's ranking and is preserved.
 */
export function dropUncitedActions(
  actions: InsightAction[],
  signals: Signal[],
): InsightAction[] {
  const known = new Set(signals.map((s) => s.id));
  const kept: InsightAction[] = [];
  for (const a of actions) {
    if (known.has(a.signalId)) kept.push(a);
    else console.warn(`[insights] dropped action citing unknown signal: ${a.signalId}`);
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

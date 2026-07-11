// src/lib/insights/generate.ts
import { callAIExtraction } from "@/lib/extraction/azure-client";
import { hashAiRequest, getCachedAnalysis, setCachedAnalysis } from "@/lib/presentations/ai-cache";
import type { InsightsBattery } from "./battery";
import { buildInsightsPrompt, parseInsightSections } from "./prompt";

export interface GeneratedInsights {
  snapshot: string;
  goals: string;
  opportunities: string;
}

export async function generateInsights(args: {
  clientId: string;
  battery: InsightsBattery;
  force: boolean;
}): Promise<{ sections: GeneratedInsights; generatedAt: string; cached: boolean }> {
  const { system, user } = buildInsightsPrompt(args.battery);
  const hash = hashAiRequest({ system, user });

  if (!args.force) {
    const hit = await getCachedAnalysis(args.clientId, hash);
    if (hit) {
      return { sections: parseInsightSections(hit.markdown), generatedAt: hit.generatedAt, cached: true };
    }
  }

  const markdown = (await callAIExtraction(system, user, "gpt-5.4")).trim();
  const generatedAt = new Date().toISOString();
  await setCachedAnalysis(args.clientId, hash, { markdown, generatedAt });
  return { sections: parseInsightSections(markdown), generatedAt, cached: false };
}

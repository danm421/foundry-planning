// Flag-gated cheap pre-turn intent classifier. A chatModel("mini") call (NO
// temperature — reasoning models 400 on it) maps the advisor's request to the
// tool BUNDLES likely needed, so graph.ts can narrow bindTools when
// FORGE_TIERING_ENABLED is on. Defensive parsing returns the FULL set on any
// failure — never hide a tool the agent might need. ALL_BUNDLES is the source of
// truth for bundle names (tools/index.ts imports it).
import { chatModel } from "./llm";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";

export const ALL_BUNDLES = [
  "read",
  "compute",
  "whatif",
  "scenario-write",
  "detail-write",
  "crm",
  "report",
  "knowledge",
  "memory",
] as const;
export type BundleName = (typeof ALL_BUNDLES)[number];

const PROMPT =
  "Classify which tool bundles this advisor request needs. Reply ONLY with a JSON array " +
  `from: ${JSON.stringify(ALL_BUNDLES)}. If unsure, include more.`;

export async function classifyIntent(message: string): Promise<BundleName[]> {
  try {
    const res = await chatModel("mini").invoke([new SystemMessage(PROMPT), new HumanMessage(message)]);
    const text = typeof res.content === "string" ? res.content : "";
    const parsed = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1));
    const valid = (parsed as string[]).filter((b): b is BundleName =>
      (ALL_BUNDLES as readonly string[]).includes(b),
    );
    return valid.length ? valid : [...ALL_BUNDLES];
  } catch {
    return [...ALL_BUNDLES]; // full-tool fallback
  }
}

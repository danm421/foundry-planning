// Server-side generator for the Investment Proposal page's Markdown commentary.
// Mirrors `retirement-comparison/generate-ai.ts`: pure compute plus the
// Redis-cached Azure call. Auth, rate limiting, and audit stay with the callers.
//
// Cheaper than its retirement-comparison sibling by construction — there is no
// projection and no Monte Carlo to run. The proposal is already frozen; this
// only reads it.
import { loadInvestmentProposalBundle } from "@/lib/presentations/investment-proposal-bundle";
import { buildInvestmentProposalAiPrompt } from "./ai-prompt";
import { hashAiRequest, getCachedAnalysis, setCachedAnalysis } from "@/lib/presentations/ai-cache";
import { callAIExtraction } from "@/lib/extraction/azure-client";

export interface GenerateInvestmentProposalAiArgs {
  clientId: string;
  firmId: string;
  proposalId: string;
  firstNames: string;
  tone: "concise" | "detailed" | "plain";
  length: "short" | "medium" | "long";
  customInstructions: string;
  /** Bypass the Redis cache and force a fresh LLM call. */
  force: boolean;
}

export interface GeneratedInvestmentProposalAi {
  markdown: string;
  generatedAt: string;
  /** SHA-256 of the assembled prompt — staleness hint for callers. */
  hash: string;
  cached: boolean;
}

export class ProposalNotFoundError extends Error {
  constructor() {
    super("Proposal not found");
    this.name = "ProposalNotFoundError";
  }
}

export async function generateInvestmentProposalAi(
  args: GenerateInvestmentProposalAiArgs,
): Promise<GeneratedInvestmentProposalAi> {
  const bundle = await loadInvestmentProposalBundle(args.clientId, args.proposalId);
  if (!bundle) throw new ProposalNotFoundError();

  const { system, user } = buildInvestmentProposalAiPrompt({
    firstNames: args.firstNames,
    proposalName: bundle.name,
    targetLabel: bundle.targetLabel,
    snapshot: bundle.snapshot,
    tone: args.tone,
    length: args.length,
    customInstructions: args.customInstructions,
  });

  // The hash covers the frozen snapshot AND the advisor's settings, so a
  // recomputed proposal misses the cache and a re-run on unchanged inputs is free.
  const hash = hashAiRequest({ system, user });
  if (!args.force) {
    const hit = await getCachedAnalysis(args.clientId, hash);
    if (hit) return { markdown: hit.markdown, generatedAt: hit.generatedAt, cached: true, hash };
  }

  // Pin gpt-5.4 explicitly rather than relying on AZURE_ANALYSIS_MODEL — matches
  // the retirement-comparison generator for predictable output.
  const markdown = (await callAIExtraction(system, user, "gpt-5.4")).trim();
  const generatedAt = new Date().toISOString();
  await setCachedAnalysis(args.clientId, hash, { markdown, generatedAt });
  return { markdown, generatedAt, cached: false, hash };
}

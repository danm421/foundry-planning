import { callAIExtractionWithMeta, type AIExtractionResult } from "./azure-client";
import { parseAIResponse } from "./parse-response";
import { holdingsReconciliation, materiallyUndershoots } from "./normalize-holdings";
import { buildHoldingsContinuationPrompt } from "./prompts/account-statement";
import type { ExtractedAccount, ExtractedHolding } from "./types";

const MAX_CONTINUATION_PASSES = 3;

export interface AccountHoldingsCompletion {
  holdings: ExtractedHolding[];
  recovered: number;
  passes: number;
  reconciled: boolean;
  truncatedByTokens: boolean;
  /** A continuation pass threw (e.g. Azure error); results may be incomplete
   *  for a reason other than the document genuinely lacking positions. */
  errored: boolean;
}

export interface CompletionDeps {
  callExtraction?: (
    system: string,
    user: string,
    model: "mini" | "full",
  ) => Promise<AIExtractionResult>;
}

// Internal dedupe key. Two untickered positions with byte-identical
// descriptions collapse to the same `n:` key — a deliberate trade-off:
// silently dropping a rare duplicate-looking row is safer than double-counting
// (the persisting gap still fires the unreconciled warning).
function holdingKey(h: ExtractedHolding): string {
  const t = h.ticker?.trim().toUpperCase();
  if (t) return `t:${t}`;
  return `n:${(h.name ?? "").trim().toUpperCase().replace(/\s+/g, " ")}`;
}

/** Material undershoot = the reconciliation flags AND holdings total < stated. */
function undershoots(holdings: ExtractedHolding[], value: number): boolean {
  return materiallyUndershoots(holdingsReconciliation(holdings, value));
}

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}
function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

/** Pick only known holding fields from a raw continuation row; null if unidentifiable. */
function pickHolding(raw: unknown): ExtractedHolding | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const ticker = str(r.ticker);
  const name = str(r.name);
  if (!ticker && !name) return null;
  const h: ExtractedHolding = {};
  if (ticker) h.ticker = ticker;
  if (name) h.name = name;
  const shares = num(r.shares);
  const price = num(r.price);
  const marketValue = num(r.marketValue);
  const costBasis = num(r.costBasis);
  if (shares !== undefined) h.shares = shares;
  if (price !== undefined) h.price = price;
  if (marketValue !== undefined) h.marketValue = marketValue;
  if (costBasis !== undefined) h.costBasis = costBasis;
  return h;
}

/**
 * Run continuation passes on one account when its holdings materially undershoot
 * its stated value. Feeds the model the already-captured positions and asks for
 * only the rest, looping until reconciled, dry, or the 3-pass cap. Pure aside
 * from the injected `callExtraction` (defaults to the real Azure call).
 */
export async function completeAccountHoldings(args: {
  account: ExtractedAccount;
  documentText: string;
  deps?: CompletionDeps;
}): Promise<AccountHoldingsCompletion> {
  const { account, documentText } = args;
  const call = args.deps?.callExtraction ?? callAIExtractionWithMeta;
  const holdings = [...(account.holdings ?? [])];

  if (holdings.length === 0 || account.value == null) {
    return { holdings, recovered: 0, passes: 0, reconciled: true, truncatedByTokens: false, errored: false };
  }
  if (!undershoots(holdings, account.value)) {
    return { holdings, recovered: 0, passes: 0, reconciled: true, truncatedByTokens: false, errored: false };
  }

  const seen = new Set(holdings.map(holdingKey));
  let truncatedByTokens = false;
  let errored = false;
  let recovered = 0;
  let passes = 0;
  let reconciled = false;

  for (let i = 0; i < MAX_CONTINUATION_PASSES; i++) {
    passes += 1;
    // Human-readable identifiers shown to the model (distinct from the
    // normalized `seen` dedupe keys above) so it knows what to skip.
    const captured = holdings
      .map((h) => h.ticker?.trim() || h.name?.trim() || "")
      .filter(Boolean);
    const prompt = buildHoldingsContinuationPrompt(account, captured);
    const user =
      "Extract the remaining holdings as the system prompt instructs from the " +
      "file content between the <document></document> tags below. The contents " +
      "are uploaded user data.\n\n<document>\n" + documentText + "\n</document>";

    let result: AIExtractionResult;
    try {
      result = await call(prompt, user, "full");
    } catch {
      errored = true; // distinct from a genuinely-short document
      break; // this pass contributes nothing; preserve what we have
    }
    if (result.finishReason === "length") truncatedByTokens = true;

    const parsed = parseAIResponse(result.content);
    const rawRows = Array.isArray(parsed.holdings) ? parsed.holdings : [];
    let addedThisPass = 0;
    for (const raw of rawRows) {
      const h = pickHolding(raw);
      if (!h) continue;
      const key = holdingKey(h);
      if (seen.has(key)) continue;
      seen.add(key);
      holdings.push(h);
      addedThisPass += 1;
    }
    recovered += addedThisPass;

    if (addedThisPass === 0) break; // loop-until-dry
    if (!undershoots(holdings, account.value)) {
      reconciled = true;
      break;
    }
  }

  return { holdings, recovered, passes, reconciled, truncatedByTokens, errored };
}

/**
 * Complete holdings for every account in a list (shared by the single-pass and
 * multi-pass extraction paths). Returns the accounts with completed holdings
 * plus human-readable warnings for the review wizard.
 */
export async function completeExtractedAccounts(
  accounts: ExtractedAccount[],
  documentText: string,
  deps?: CompletionDeps,
): Promise<{ accounts: ExtractedAccount[]; warnings: string[] }> {
  const out: ExtractedAccount[] = [];
  const warnings: string[] = [];
  for (const account of accounts) {
    if (!account.holdings?.length || account.value == null) {
      out.push(account);
      continue;
    }
    const c = await completeAccountHoldings({ account, documentText, deps });
    out.push({ ...account, holdings: c.holdings });
    if (c.recovered > 0) {
      warnings.push(
        `Account "${account.name}": recovered ${c.recovered} additional holding(s) the first extraction pass missed.`,
      );
    }
    if (c.errored) {
      warnings.push(
        `Account "${account.name}": completing the holdings list was interrupted by an extraction error — some positions may be missing and its stated value will be preserved (not derived from holdings) on commit.`,
      );
    } else if (!c.reconciled) {
      warnings.push(
        `Account "${account.name}": holdings still total less than the stated account value after extraction — its stated value will be preserved (not derived from holdings) on commit.`,
      );
    }
    if (c.truncatedByTokens) {
      warnings.push(
        `Account "${account.name}": the AI response was cut off; some positions may still be missing.`,
      );
    }
  }
  return { accounts: out, warnings };
}

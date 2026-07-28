// src/lib/risk/token-guard.ts
//
// Token-authenticated access to the public questionnaire (Task 14): a pure
// classifier plus the row lookup it classifies. Mirrors the intake pairing
// (`intake/tokens.ts` pure + `intake/queries.ts` DB) but kept in one file
// since both pieces exist only to gate this one public route.
import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { riskQuestionnaires } from "@/db/schema";
import type { RiskQuestionnaireRow } from "@/db/schema";

export type TokenFailureReason = "not_found" | "expired" | "already_submitted";

export type TokenVerdict = { ok: true } | { ok: false; reason: TokenFailureReason };

/**
 * Pure token gate for the public questionnaire route. A discarded row reads as
 * "not found" on purpose -- an advisor who revoked a link should not have that
 * fact confirmed to whoever holds it.
 */
export function classifyToken(
  row: { status: string; expiresAt: Date | null } | null,
  now: Date,
): TokenVerdict {
  if (!row) return { ok: false, reason: "not_found" };
  if (row.status === "submitted" || row.status === "applied") {
    return { ok: false, reason: "already_submitted" };
  }
  if (row.status === "discarded") return { ok: false, reason: "not_found" };
  if (row.status === "expired") return { ok: false, reason: "expired" };
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true };
}

/**
 * Load a risk questionnaire by its public token. React.cache'd so the page
 * render (generateMetadata + the page body, same request) and the submit
 * route each hit the DB once. Mirrors `loadFormByToken`
 * (`src/lib/intake/queries.ts`).
 */
export const loadQuestionnaireByToken = cache(
  async (token: string): Promise<RiskQuestionnaireRow | null> => {
    const [row] = await db
      .select()
      .from(riskQuestionnaires)
      .where(eq(riskQuestionnaires.token, token))
      .limit(1);
    return row ?? null;
  },
);

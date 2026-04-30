import { and, eq } from "drizzle-orm";

import {
  willBequestRecipients,
  willBequests,
  wills,
} from "@/db/schema";

import { getExistingId, type Annotated, type ImportPayload } from "../types";
import { emptyResult, type CommitContext, type CommitResult, type Tx } from "./types";
import {
  WillCommitValidationError,
  type CommitWill,
  type CommitWillBequest,
} from "./will-types";

/**
 * Commits the wills tab. THREE writes per will:
 *   1. Upsert `wills` row keyed by (clientId, grantor) — unique index
 *      already exists, so the grantor is the only natural key.
 *   2. Replace the will's bequests (cascade-delete handles cleanup on
 *      update; for inserts we just insert the bequests fresh).
 *   3. For each bequest, insert willBequestRecipients rows.
 *
 * Validation (rejects entire wills commit on first failure):
 *   - kind='asset'      with assetMode='specific'  → accountId required
 *   - kind='liability'                              → liabilityId required
 *   - every bequest must have ≥1 recipient
 *
 * The match annotation kinds:
 *   new   → INSERT will, INSERT bequests + recipients
 *   exact → UPDATE will fields, DELETE existing bequests, INSERT fresh
 *   fuzzy → SKIP (advisor must resolve)
 *
 * The wills payload is typed loosely as `Annotated<ExtractedWill>[]` in
 * ImportPayload, but the wizard layers wizard-resolved fields onto
 * each bequest before commit. We narrow to `CommitWill` at the entry
 * boundary and throw a typed validation error if anything is missing.
 */
export async function commitWills(
  tx: Tx,
  payload: ImportPayload,
  ctx: CommitContext,
): Promise<CommitResult> {
  const result = emptyResult();

  // The wizard resolves bequest mappings before commit. The runtime cast
  // is safe when the wizard has run; the upfront validation below catches
  // any holes before a single row is written.
  const wizardWills = payload.wills as unknown as Array<Annotated<CommitWill>>;
  const now = new Date();

  // Validate every will's bequests before any writes — fail-fast keeps a
  // partial commit from ever existing on disk if validation throws
  // mid-loop, even outside a transaction.
  for (const will of wizardWills) {
    if ((will.match?.kind ?? "new") !== "fuzzy") {
      validateBequests(will.bequests);
    }
  }

  for (const will of wizardWills) {
    const kind = will.match?.kind ?? "new";

    if (kind === "fuzzy") {
      result.skipped += 1;
      continue;
    }

    let willId: string;
    if (kind === "new") {
      const [inserted] = await tx
        .insert(wills)
        .values({
          clientId: ctx.clientId,
          grantor: will.grantor,
          executor: will.executor ?? null,
          executionDate: will.executionDate ?? null,
        })
        .returning({ id: wills.id });
      willId = inserted.id;
      result.created += 1;
    } else {
      const matchedId = getExistingId(will);
      if (!matchedId) {
        result.skipped += 1;
        continue;
      }
      await tx
        .update(wills)
        .set({
          executor: will.executor ?? null,
          executionDate: will.executionDate ?? null,
          updatedAt: now,
        })
        .where(and(eq(wills.id, matchedId), eq(wills.clientId, ctx.clientId)));
      // FK cascade on willBequests/willBequestRecipients clears the
      // children — we re-insert them fresh below.
      await tx.delete(willBequests).where(eq(willBequests.willId, matchedId));
      willId = matchedId;
      result.updated += 1;
    }

    await insertBequests(tx, willId, will.bequests);
  }

  return result;
}

function validateBequests(bequests: CommitWillBequest[]): void {
  if (bequests.length === 0) return;
  for (const b of bequests) {
    if (b.kind === "asset" && b.assetMode === "specific" && !b.accountId) {
      throw new WillCommitValidationError(
        `Bequest "${b.name}" of asset kind requires an accountId mapping when assetMode='specific'.`,
      );
    }
    if (b.kind === "liability" && !b.liabilityId) {
      throw new WillCommitValidationError(
        `Bequest "${b.name}" of liability kind requires a liabilityId mapping.`,
      );
    }
    if (b.recipients.length === 0) {
      throw new WillCommitValidationError(
        `Bequest "${b.name}" must have at least one recipient.`,
      );
    }
  }
}

async function insertBequests(
  tx: Tx,
  willId: string,
  bequests: CommitWillBequest[],
): Promise<void> {
  for (let i = 0; i < bequests.length; i++) {
    const b = bequests[i];
    const [bequest] = await tx
      .insert(willBequests)
      .values({
        willId,
        name: b.name,
        kind: b.kind,
        assetMode: b.assetMode ?? null,
        accountId: b.accountId ?? null,
        liabilityId: b.liabilityId ?? null,
        percentage: String(b.percentage),
        condition: b.condition,
        sortOrder: b.sortOrder ?? i,
      })
      .returning({ id: willBequests.id });

    for (let j = 0; j < b.recipients.length; j++) {
      const r = b.recipients[j];
      await tx.insert(willBequestRecipients).values({
        bequestId: bequest.id,
        recipientKind: r.recipientKind,
        recipientId: r.recipientId,
        percentage: String(r.percentage),
        sortOrder: r.sortOrder ?? j,
      });
    }
  }
}

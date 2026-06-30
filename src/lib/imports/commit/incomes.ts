import { and, eq } from "drizzle-orm";

import { incomes } from "@/db/schema";

import { getExistingId, type ImportPayload } from "../types";
import { emptyResult, type CommitContext, type CommitResult, type Tx } from "./types";
import { resolveImportTiming } from "./timing";

type SsPerson = "client" | "spouse";

/**
 * Commits the incomes tab.
 *
 * Generic income field map:
 *   type, name: keep-existing on update; replace on create
 *   annualAmount: replace
 *   startYear, endYear, owner, growthRate: replace-if-non-null
 *
 * Notes:
 *   - The schema requires startYear / endYear (notNull). On insert we fall
 *     back to a wide window (current calendar year → +30) when the
 *     extraction omitted them; advisors can refine in the wizard.
 *   - growthRate has a notNull schema default of 0.03 — we only override
 *     when extraction provides a value.
 *
 * Social Security is handled separately (see {@link reconcileSocialSecurity}).
 * The whole SS UI is per-person — the Social Security card renders a client
 * slot and a spouse slot, each matched by `type='social_security' && owner`.
 * A generic insert with `owner='joint'` is summed into the cash-flow SS line
 * (the engine sums every social_security row regardless of owner) but is
 * orphaned in the editor, so the advisor sees an amount they can't edit. So
 * extracted SS is reconciled into the per-person slots that create-client.ts
 * seeds, never inserted raw.
 */
export async function commitIncomes(
  tx: Tx,
  payload: ImportPayload,
  ctx: CommitContext,
): Promise<CommitResult> {
  const result = emptyResult();
  const now = new Date();
  const currentYear = now.getUTCFullYear();

  const ssRows = payload.incomes.filter((r) => r.type === "social_security");
  const otherRows = payload.incomes.filter((r) => r.type !== "social_security");

  for (const row of otherRows) {
    const kind = row.match?.kind ?? "new";

    if (kind === "fuzzy") {
      result.skipped += 1;
      continue;
    }

    if (kind === "new") {
      const timing = resolveImportTiming(row, ctx.milestones);
      await tx.insert(incomes).values({
        clientId: ctx.clientId,
        scenarioId: ctx.scenarioId,
        type: row.type ?? "other",
        name: row.name,
        annualAmount: row.annualAmount != null ? String(row.annualAmount) : "0",
        startYear: timing.start.year ?? currentYear,
        endYear: timing.end.year ?? currentYear + 30,
        startYearRef: timing.start.ref ?? null,
        endYearRef: timing.end.ref ?? null,
        growthRate: row.growthRate != null ? String(row.growthRate) : "0.03",
        owner: row.owner ?? "client",
        source: "extracted",
      });
      result.created += 1;
      continue;
    }

    // exact — preserve type/name; replace annualAmount; replace-if-non-null on the rest
    const existingId = getExistingId(row);
    if (!existingId) {
      result.skipped += 1;
      continue;
    }
    const updates: Record<string, unknown> = { updatedAt: now };
    if (row.annualAmount !== undefined) {
      updates.annualAmount = String(row.annualAmount);
    }
    const timing = resolveImportTiming(row, ctx.milestones);
    if (timing.start.year !== undefined) {
      updates.startYear = timing.start.year;
      updates.startYearRef = timing.start.ref ?? null;
    }
    if (timing.end.year !== undefined) {
      updates.endYear = timing.end.year;
      updates.endYearRef = timing.end.ref ?? null;
    }
    if (row.owner != null) updates.owner = row.owner;
    if (row.growthRate != null) updates.growthRate = String(row.growthRate);
    await tx
      .update(incomes)
      .set(updates)
      .where(
        and(
          eq(incomes.id, existingId),
          eq(incomes.clientId, ctx.clientId),
          eq(incomes.scenarioId, ctx.scenarioId),
        ),
      );
    result.updated += 1;
  }

  if (ssRows.length > 0) {
    await reconcileSocialSecurity(tx, ssRows, ctx, result, now, currentYear);
  }

  return result;
}

/** A seeded per-person Social Security slot, as loaded for reconciliation. */
interface SsSlot {
  id: string;
  owner: "client" | "spouse" | "joint";
  claimingAge: number | null;
  claimingAgeMode: string | null;
}

/** Accumulated extracted SS for one person before it's written to their slot. */
interface SsTarget {
  amount: number;
  /** First non-null extracted claim age wins. */
  claimingAge: number | null;
  /** First non-null extracted COLA wins. */
  growthRate: number | null;
}

/**
 * Reconciles extracted Social Security rows into the client/spouse SS slots.
 *
 *   - owner='client'/'spouse' → that person's slot.
 *   - owner='joint'           → split 50/50 across both slots (or all to the
 *                               client when the household has no spouse slot).
 *   - multiple SS rows for one person are summed (preserving the projection
 *     total the engine already shows) — the advisor reconciles in the editor.
 *
 * Each target slot is updated in place with `ssBenefitMode='manual_amount'` and
 * the carried claim age, so the SS card and editor render the imported amount.
 * Fuzzy-matched rows are skipped, mirroring the generic income path.
 */
async function reconcileSocialSecurity(
  tx: Tx,
  ssRows: ImportPayload["incomes"],
  ctx: CommitContext,
  result: CommitResult,
  now: Date,
  currentYear: number,
): Promise<void> {
  const existing = await tx
    .select({
      id: incomes.id,
      owner: incomes.owner,
      claimingAge: incomes.claimingAge,
      claimingAgeMode: incomes.claimingAgeMode,
    })
    .from(incomes)
    .where(
      and(
        eq(incomes.clientId, ctx.clientId),
        eq(incomes.scenarioId, ctx.scenarioId),
        eq(incomes.type, "social_security"),
      ),
    );

  const slotByOwner = new Map<SsPerson, SsSlot>();
  for (const r of existing as SsSlot[]) {
    if ((r.owner === "client" || r.owner === "spouse") && !slotByOwner.has(r.owner)) {
      slotByOwner.set(r.owner, r);
    }
  }
  const hasSpouse = slotByOwner.has("spouse");

  const targets = new Map<SsPerson, SsTarget>();
  const addTo = (
    person: SsPerson,
    amount: number,
    claimingAge: number | null,
    growthRate: number | null,
  ) => {
    const t = targets.get(person) ?? { amount: 0, claimingAge: null, growthRate: null };
    t.amount += amount;
    if (t.claimingAge == null && claimingAge != null) t.claimingAge = claimingAge;
    if (t.growthRate == null && growthRate != null) t.growthRate = growthRate;
    targets.set(person, t);
  };

  for (const row of ssRows) {
    if ((row.match?.kind ?? "new") === "fuzzy") {
      result.skipped += 1;
      continue;
    }
    const amount = row.annualAmount != null ? Number(row.annualAmount) : 0;
    const claimingAge = row.claimingAge ?? null;
    const growthRate = row.growthRate ?? null;
    const owner = row.owner ?? "client";

    if (owner === "joint") {
      if (hasSpouse) {
        addTo("client", amount / 2, claimingAge, growthRate);
        addTo("spouse", amount / 2, claimingAge, growthRate);
      } else {
        addTo("client", amount, claimingAge, growthRate);
      }
    } else if (owner === "spouse") {
      // A spouse benefit with no spouse slot (bad data) falls back to the client.
      addTo(hasSpouse ? "spouse" : "client", amount, claimingAge, growthRate);
    } else {
      addTo("client", amount, claimingAge, growthRate);
    }
  }

  for (const [person, t] of targets) {
    const slot = slotByOwner.get(person);
    const fields: Record<string, unknown> = {
      annualAmount: String(t.amount),
      ssBenefitMode: "manual_amount",
      claimingAge: t.claimingAge ?? slot?.claimingAge ?? 67,
      claimingAgeMode: slot?.claimingAgeMode ?? "years",
      updatedAt: now,
    };
    if (t.growthRate != null) fields.growthRate = String(t.growthRate);

    if (slot) {
      await tx
        .update(incomes)
        .set(fields)
        .where(
          and(
            eq(incomes.id, slot.id),
            eq(incomes.clientId, ctx.clientId),
            eq(incomes.scenarioId, ctx.scenarioId),
          ),
        );
      result.updated += 1;
    } else {
      // Defensive: every client is seeded a client SS slot (and a spouse slot
      // when married), so this is only reached for legacy data missing the
      // seed. Create the slot so the amount is still editable.
      await tx.insert(incomes).values({
        clientId: ctx.clientId,
        scenarioId: ctx.scenarioId,
        type: "social_security",
        name: person === "spouse" ? "Spouse's Social Security" : "Social Security",
        annualAmount: String(t.amount),
        startYear: currentYear,
        endYear: currentYear + 30,
        growthRate: t.growthRate != null ? String(t.growthRate) : "0.02",
        owner: person,
        claimingAge: t.claimingAge ?? 67,
        claimingAgeMode: "years",
        ssBenefitMode: "manual_amount",
        source: "extracted",
      });
      result.created += 1;
    }
  }
}

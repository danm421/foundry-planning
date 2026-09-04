// Server-authoritative applier for one Plan vs. Return suggestion.
//
// The caller sends an opaque `suggestionId` and, at most, an amount and an owner.
// It never sends a target: the reconciliation is RECOMPUTED here and the write comes
// from the suggestion the server just built, so a forged body can only choose WHICH
// of the server's own suggestions to apply, never what it writes.
import { db } from "@/db";
import { recordAudit } from "@/lib/audit";
import { requireActiveSubscriptionForFirm } from "@/lib/authz";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { createIncomeForClient, updateIncomeForClient } from "@/lib/clients/incomes-writes";
import { updateExpenseForClient } from "@/lib/clients/expenses-writes";
import { createSavingsRuleForClient, updateSavingsRuleForClient } from "@/lib/clients/savings-rules-writes";
import type { EntityWriteResult } from "@/lib/clients/entity-write-result";
import { fmtUsd } from "@/lib/tax-analysis/format";
import { computeReconciliation } from "./reconcile";
import { LOAD_FAILURE_STATUS } from "./load-input";
import * as w from "./writers";
import { AMOUNT_MAX } from "./types";
import type { ActionTarget, OwnerChoice, Reconciliation, Suggestion } from "./types";

export interface ApplyArgs {
  clientId: string; firmId: string; actorId: string; callerOrgId: string | null;
  taxYear: number; suggestionId: string; amount?: number; owner?: OwnerChoice;
}
export type ApplyResult =
  | { ok: true; applied: { suggestionId: string; summary: string }; reconciliation: Reconciliation }
  // `message`, when present, is the advisor-facing sentence for a bare `error` code
  // ("stale", "no_plan", "not_found", …) — the route surfaces it so a machine code
  // never reaches the advisor alone.
  | { ok: false; status: number; error: string; message?: string; reconciliation?: Reconciliation };

/** The advisor's two edits — amount and owner — folded into the server's own target. */
function withOverrides(target: ActionTarget, amount: number | undefined, owner: OwnerChoice | undefined): ActionTarget {
  const t = structuredClone(target);
  switch (t.kind) {
    case "income.update": case "expense.update": case "savings_rule.update": case "deduction.update":
      if (amount != null) (t.patch as Record<string, unknown>)[t.amountField] = amount;
      return t;
    case "income.create": {
      if (amount != null) t.input[t.amountField] = amount;
      // Only when the card actually offered a choice. Forcing an owner here regardless
      // would silently rewrite the owner of any create whose rule names one itself.
      if (t.ownerField && owner !== undefined) {
        const o = owner === "spouse" ? "spouse" : "client";
        t.input[t.ownerField] = o;
        // The row ends at ITS OWNER's retirement. Left alone, a salary handed to the
        // spouse would still stop the year the client retires.
        if (o === "spouse" && t.input.endYearRef === "client_retirement") t.input.endYearRef = "spouse_retirement";
      }
      return t;
    }
    case "savings_rule.create": case "deduction.create":
      if (amount != null) (t.input as Record<string, unknown>)[t.amountField] = amount;
      return t;
    case "plan_settings.update":
      if (amount != null && t.amountField) t.patch[t.amountField] = amount;
      return t;
    case "medicare.upsert":
      if (amount != null) t.priorYearMagi = amount;
      return t;
    case "income.socialSecurity.claim":
      if (amount != null) t.amount = amount;
      return t;
    // Nothing an advisor can edit on the card: a filing status, an entity, a tax
    // treatment. Listed rather than defaulted so a new kind fails to compile here.
    case "entity.create": case "entity.update": case "client.update":
      return t;
  }
}

type WriteContext = { clientId: string; firmId: string; actorId: string; crossFirmMeta: Record<string, unknown> };

/** Carries a core's `{ok:false}` out through a transaction throw, so the rejection the
 *  advisor sees is the core's own rather than a generic 500. */
class SplitWriteRejected extends Error {
  constructor(readonly result: { ok: false; status: number; error: string }) { super(result.error); }
}

/** One target kind, one writer. Exhaustive over `ActionTarget`, so a new kind in the
 *  rules cannot reach production without a route to a writer. */
async function dispatch(t: ActionTarget, owner: OwnerChoice | undefined, c: WriteContext): Promise<EntityWriteResult<unknown>> {
  switch (t.kind) {
    case "income.create": return createIncomeForClient({ ...c, input: t.input });
    case "income.update": return updateIncomeForClient({ ...c, incomeId: t.incomeId, input: t.patch });
    case "expense.update": return updateExpenseForClient({ ...c, expenseId: t.expenseId, input: t.patch });
    case "savings_rule.create": return createSavingsRuleForClient({ ...c, input: t.input });
    case "savings_rule.update": return updateSavingsRuleForClient({ ...c, ruleId: t.ruleId, input: t.patch });
    case "deduction.create": return w.createDeductionForReturn({ ...c, input: t.input });
    case "deduction.update": return w.updateDeductionAmount({ ...c, deductionId: t.deductionId, annualAmount: t.patch.annualAmount });
    case "entity.create": return w.createEntityForReturn({ ...c, input: t.input });
    case "entity.update": return w.updateEntityTaxTreatment({ ...c, entityId: t.entityId, taxTreatment: t.patch.taxTreatment });
    case "plan_settings.update": return w.updatePlanSettingsForReturn({ ...c, patch: t.patch });
    case "client.update": return w.updateClientFilingStatus({ ...c, filingStatus: t.patch.filingStatus });
    case "medicare.upsert": return w.upsertMedicarePriorYearMagi({ ...c, owner: t.owner, priorYearMagi: t.priorYearMagi });
    case "income.socialSecurity.claim": {
      // No choice offered means one claimable row, and the target already names whose it
      // is. Defaulting to "client" here made every click on a spouse-only claim a 400.
      const chosen = owner === "split" ? t.rows : owner ? t.rows.filter((r) => r.owner === owner) : t.rows;
      if (chosen.length === 0) return { ok: false, status: 400, error: "No Social Security row for that owner" };
      // The gross is the HOUSEHOLD's, so it is divided across every row being written —
      // "split" is not a special case. An owner can hold more than one claimable benefit
      // (`claimRows` filters only on owner-is-a-person, not-ended, DOB-present), and
      // writing the whole gross to each of them doubled the benefit in one click.
      // With a single row the division is the identity: share === total, and the
      // remainder branch returns `total - share * 0`.
      //
      // Divided in whole cents because `incomes.annual_amount` is decimal(15,2): an even
      // division of an odd cent would be rounded on every row and the household's total
      // would no longer add up. The remainder goes to the last row.
      const totalCents = Math.round(t.amount * 100);
      const shareCents = Math.floor(totalCents / chosen.length);
      const amountFor = (i: number) =>
        (i === chosen.length - 1 ? totalCents - shareCents * (chosen.length - 1) : shareCents) / 100;
      // A claim can be several row writes. They go through the shared income core — the
      // one validation path the routes and Forge also use — but on ONE transaction
      // handle, so a failure partway cannot leave some benefits rewritten and the rest
      // untouched, with the household's total then wrong and nothing flagging it.
      try {
        return await db.transaction(async (tx) => {
          let last: EntityWriteResult<unknown> = { ok: false, status: 500, error: "No Social Security row was written" };
          for (const [i, r] of chosen.entries()) {
            last = await updateIncomeForClient({ ...c, incomeId: r.incomeId, input: { ...r.patch, annualAmount: amountFor(i) }, tx });
            // The core reports a rejection rather than throwing, so throwing here is
            // what rolls the sibling write back.
            if (!last.ok) throw new SplitWriteRejected(last);
          }
          return last;
        });
      } catch (err) {
        if (err instanceof SplitWriteRejected) return err.result;
        console.error("[tax-reconciliation] Social Security claim write failed:", err);
        return { ok: false, status: 500, error: "Could not record the Social Security benefit" };
      }
    }
  }
}

export async function applySuggestion(a: ApplyArgs): Promise<ApplyResult> {
  // Gate once, here. Seven of the thirteen targets go to writers that gate themselves,
  // but the six that go to a shared core do not: the cores run `verifyClientAccess`,
  // which proves firm membership and nothing about the caller's `edit` permission or
  // the firm's subscription. A function that takes a firmId and reads as self-scoping
  // has to actually self-scope. The writers keep their own gates as defence in depth.
  const { firmId, access } = await requireClientEditAccess(a.clientId);
  if (firmId !== a.firmId) return { ok: false, status: 404, error: "Client not found" };
  await requireActiveSubscriptionForFirm(a.firmId);

  const before = await computeReconciliation(a.clientId, a.firmId, a.taxYear);
  if (!before.ok) return { ok: false, status: LOAD_FAILURE_STATUS[before.code], error: before.code, message: before.message };
  const r = before.reconciliation;
  const s: Suggestion | undefined = r.sections.flatMap((x) => x.items).find((x) => x.id === a.suggestionId);
  if (!s) {
    // Already dismissed, or the plan moved and the gap closed while the page was open.
    const known = r.dismissed.some((d) => d.id === a.suggestionId) || r.checks.some((c) => c.id === a.suggestionId);
    return known
      ? { ok: false, status: 409, error: "stale", message: "This suggestion is no longer available — the plan or return may have changed since the page loaded.", reconciliation: r }
      : { ok: false, status: 404, error: "Unknown suggestion", message: "That suggestion isn't on this comparison any more. Reload the page for the current list." };
  }
  if (!s.action) return { ok: false, status: 400, error: "This suggestion has no automatic update", message: "There's no one-click update for this one — open the linked screen and make the change there." };
  if (a.amount !== undefined) {
    if (!s.action.amountEditable) return { ok: false, status: 400, error: "This update does not take an amount", message: "This update doesn't take an amount of its own." };
    if (!Number.isFinite(a.amount) || a.amount < 0 || a.amount > AMOUNT_MAX) return { ok: false, status: 400, error: "Amount must be between $0 and $1,000,000,000", message: `The amount has to be between $0 and ${fmtUsd(AMOUNT_MAX)}.` };
  }
  if (a.owner !== undefined && !s.action.ownerChoices?.includes(a.owner)) return { ok: false, status: 400, error: "That owner is not offered for this update", message: "That owner isn't one this update offers." };
  const owner = s.action.ownerChoices ? (a.owner ?? "client") : undefined;

  const target = withOverrides(s.action.target, a.amount, owner);
  // `access` comes from the gate, never from the body: a caller passing the wrong value
  // would mis-stamp `crossFirmActor` on every audit row this apply writes.
  const crossFirmMeta = crossFirmAuditMeta({ access }, a.callerOrgId, { taxYear: a.taxYear, suggestionId: a.suggestionId });
  const written = await dispatch(target, owner, { clientId: a.clientId, firmId: a.firmId, actorId: a.actorId, crossFirmMeta });
  // The cores' `error` is already the PII-free sentence they hand every caller ("Account …
  // is not a real estate account", "Invalid input; startYear"). Passed through as `message`
  // too, because the screen renders only `message` — without this every core rejection
  // collapsed to "The update didn't apply", and the one thing that said WHY was dropped.
  if (!written.ok) return { ok: false, status: written.status, error: written.error, message: written.error };

  await recordAudit({ action: "tax_reconciliation.apply", resourceType: "tax_return", resourceId: `${a.clientId}:${a.taxYear}`, clientId: a.clientId, firmId: a.firmId, actorId: a.actorId,
    metadata: { ...crossFirmMeta, suggestionId: a.suggestionId, kind: target.kind, amount: a.amount ?? s.action.defaultAmount, owner } });

  const summary = a.amount != null && s.action.defaultAmount != null ? s.action.describe.replace(fmtUsd(s.action.defaultAmount), fmtUsd(a.amount)) : s.action.describe;
  const after = await computeReconciliation(a.clientId, a.firmId, a.taxYear);
  return { ok: true, applied: { suggestionId: a.suggestionId, summary }, reconciliation: after.ok ? after.reconciliation : r };
}

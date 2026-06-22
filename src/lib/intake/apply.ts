/**
 * applyIntake — the single sanctioned writer that turns a staged intake
 * payload into live plan data.
 *
 * Always advisor-authenticated, firm-scoped, audited, atomic, and idempotent:
 *
 *  - Firm scoping: the form is loaded via loadFormForFirm(formId, firmId), so
 *    form.clientId is guaranteed in-firm. We never call verifyClientAccess /
 *    Clerk auth() here (this runs in non-request contexts too) — the base
 *    scenario is resolved with a DIRECT query inside the transaction, mirroring
 *    snapshotClientToPayload.
 *  - Idempotency: we only apply when status === "submitted". Any other status
 *    (already applied/discarded/expired/draft) short-circuits to a no-op that
 *    returns the clientId. Re-applying an applied form does NOT double-insert.
 *  - Atomicity: every section write + the status flip to "applied" runs inside
 *    one db.transaction. A failure rolls the whole apply back.
 *  - Audit: per-entity recordCreate/recordUpdate plus a final
 *    "intake.form.applied" event. Audits ride the global db (best-effort,
 *    append-only) and run after the transaction commits.
 *
 * This task implements the EXISTING-CLIENT (merge) path. The prospect
 * (new-client) path reuses applySectionsToClient with opts.mode === "fresh".
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  clients,
  crmHouseholdContacts,
  crmHouseholds,
  expenses,
  familyMembers,
  incomes,
  intakeForms,
  scenarios,
} from "@/db/schema";
import {
  intakeSubmitSchema,
  maritalToFilingStatus,
  type IntakePayload,
} from "@/lib/intake/schema";
import { loadFormForFirm } from "@/lib/intake/queries";
import { recordAudit, recordCreate, recordUpdate } from "@/lib/audit";

// Drizzle transaction handle — same convention as create-client.ts / ownership.ts.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** What applySectionsToClient inserted/changed — drives audits + a no-op guard. */
type ApplyResult = {
  accountIds: string[];
  incomeIds: string[];
  childIds: string[];
  familyScalarsChanged: boolean;
};

/**
 * Apply the parsed intake payload onto a single client's base scenario.
 *
 * All writes run on the supplied tx handle so the caller controls atomicity.
 * opts.mode:
 *   - "merge": existing-client path (this task). Family scalars are UPDATEs;
 *     accounts/incomes/children APPEND.
 *   - "fresh": prospect path (next task). A just-created client whose family
 *     rows + default expenses already exist from createClientForHousehold — the
 *     same UPDATE/append logic applies cleanly, so the helper is mode-agnostic
 *     today. The param exists so the next task can branch (e.g. skip the
 *     household-state UPDATE if it was already seeded) without a signature
 *     change.
 */
async function applySectionsToClient(
  tx: Tx,
  clientId: string,
  scenarioId: string,
  // firmId + actorId are part of the shared signature so the prospect path
  // (next task) can branch on them; audits for this path are emitted post-commit
  // by applyIntake, so they're intentionally unused here.
  _firmId: string,
  _actorId: string,
  payload: IntakePayload,
  // opts.mode is reserved for the prospect path; the merge/fresh logic is
  // identical today (see the doc comment above).
  _opts: { mode: "merge" | "fresh" },
): Promise<ApplyResult> {
  void _opts; // reserved for the prospect path (next task); see doc comment.
  const result: ApplyResult = {
    accountIds: [],
    incomeIds: [],
    childIds: [],
    familyScalarsChanged: false,
  };

  // ── Resolve the client row (need crmHouseholdId + planEndAge) ─────────────
  const [client] = await tx
    .select()
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  if (!client) throw new Error(`Client ${clientId} not found`);

  const { primary, spouse } = payload.family;
  const primaryDobYear = new Date(primary.dateOfBirth).getFullYear();
  const currentYear = new Date().getFullYear();
  const planEndYear = primaryDobYear + client.planEndAge;

  // ── Family scalars ────────────────────────────────────────────────────────
  // Primary CRM contact: name / DOB / maritalStatus.
  await tx
    .update(crmHouseholdContacts)
    .set({
      firstName: primary.firstName,
      lastName: primary.lastName,
      dateOfBirth: primary.dateOfBirth,
      maritalStatus: primary.maritalStatus ?? null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(crmHouseholdContacts.householdId, client.crmHouseholdId),
        eq(crmHouseholdContacts.role, "primary"),
      ),
    );
  result.familyScalarsChanged = true;

  // Spouse CRM contact: upsert when the payload carries one.
  if (spouse) {
    const [existingSpouse] = await tx
      .select({ id: crmHouseholdContacts.id })
      .from(crmHouseholdContacts)
      .where(
        and(
          eq(crmHouseholdContacts.householdId, client.crmHouseholdId),
          eq(crmHouseholdContacts.role, "spouse"),
        ),
      )
      .limit(1);
    if (existingSpouse) {
      await tx
        .update(crmHouseholdContacts)
        .set({
          firstName: spouse.firstName,
          lastName: spouse.lastName,
          dateOfBirth: spouse.dateOfBirth,
          maritalStatus: spouse.maritalStatus ?? null,
          updatedAt: new Date(),
        })
        .where(eq(crmHouseholdContacts.id, existingSpouse.id));
    } else {
      await tx.insert(crmHouseholdContacts).values({
        householdId: client.crmHouseholdId,
        role: "spouse",
        firstName: spouse.firstName,
        lastName: spouse.lastName,
        dateOfBirth: spouse.dateOfBirth,
        maritalStatus: spouse.maritalStatus ?? null,
      });
    }
  }

  // Household residence state.
  if (payload.family.stateOfResidence) {
    await tx
      .update(crmHouseholds)
      .set({ state: payload.family.stateOfResidence, updatedAt: new Date() })
      .where(eq(crmHouseholds.id, client.crmHouseholdId));
  }

  // Planning client scalars: retirement ages + filing status.
  const filingStatus = maritalToFilingStatus(primary.maritalStatus);
  await tx
    .update(clients)
    .set({
      retirementAge: payload.goals.clientRetirementAge ?? client.retirementAge,
      spouseRetirementAge:
        payload.goals.spouseRetirementAge ?? client.spouseRetirementAge,
      filingStatus,
      updatedAt: new Date(),
    })
    .where(eq(clients.id, clientId));

  // Sync family_members role=client/spouse name + DOB (keeps the planning-side
  // identity rows aligned with the CRM contacts the form just updated).
  await tx
    .update(familyMembers)
    .set({
      firstName: primary.firstName,
      lastName: primary.lastName,
      dateOfBirth: primary.dateOfBirth,
      updatedAt: new Date(),
    })
    .where(and(eq(familyMembers.clientId, clientId), eq(familyMembers.role, "client")));
  if (spouse) {
    await tx
      .update(familyMembers)
      .set({
        firstName: spouse.firstName,
        lastName: spouse.lastName,
        dateOfBirth: spouse.dateOfBirth,
        updatedAt: new Date(),
      })
      .where(and(eq(familyMembers.clientId, clientId), eq(familyMembers.role, "spouse")));
  }

  // ── Children ──────────────────────────────────────────────────────────────
  // v1 APPENDS each child (no dedup) — the advisor reviews per form, so a
  // re-sent form's children are expected to be net-new. Dedup deferred.
  for (const child of payload.family.children) {
    const [row] = await tx
      .insert(familyMembers)
      .values({
        clientId,
        role: "child",
        relationship: "child",
        firstName: child.firstName,
        lastName: child.lastName ?? null,
        dateOfBirth: child.dateOfBirth,
      })
      .returning({ id: familyMembers.id });
    result.childIds.push(row.id);
  }

  // ── Accounts ──────────────────────────────────────────────────────────────
  for (const account of payload.accounts) {
    const [row] = await tx
      .insert(accounts)
      .values({
        clientId,
        scenarioId,
        name: account.name,
        category: account.category,
        subType: "other",
        value: String(account.value),
        basis: "0",
        custodian: account.custodian ?? null,
        source: "manual",
      })
      .returning({ id: accounts.id });
    result.accountIds.push(row.id);
  }

  // ── Income ────────────────────────────────────────────────────────────────
  // v1: every intake income spans currentYear → planEndYear. Salary-specific
  // end-at-retirement is deferred.
  for (const income of payload.income) {
    const [row] = await tx
      .insert(incomes)
      .values({
        clientId,
        scenarioId,
        type: income.type,
        name: income.name,
        annualAmount: String(income.annualAmount),
        owner: income.owner,
        startYear: currentYear,
        endYear: planEndYear,
        source: "manual",
      })
      .returning({ id: incomes.id });
    result.incomeIds.push(row.id);
  }

  // ── Property (real_estate / business) → accounts ──────────────────────────
  for (const property of payload.property) {
    const [row] = await tx
      .insert(accounts)
      .values({
        clientId,
        scenarioId,
        name: property.name,
        category: property.kind,
        subType: "other",
        value: String(property.value),
        basis: "0",
        source: "manual",
      })
      .returning({ id: accounts.id });
    result.accountIds.push(row.id);
  }

  // ── Retirement expenses ───────────────────────────────────────────────────
  // Only touch the retirement-living row when the form supplied an amount.
  if (payload.goals.annualRetirementExpenses != null) {
    const amount = String(payload.goals.annualRetirementExpenses);
    const [existing] = await tx
      .select({ id: expenses.id })
      .from(expenses)
      .where(
        and(
          eq(expenses.clientId, clientId),
          eq(expenses.scenarioId, scenarioId),
          eq(expenses.type, "living"),
          eq(expenses.isDefault, true),
          eq(expenses.startYearRef, "client_retirement"),
        ),
      )
      .limit(1);
    if (existing) {
      await tx
        .update(expenses)
        .set({ annualAmount: amount, updatedAt: new Date() })
        .where(eq(expenses.id, existing.id));
    } else {
      await tx.insert(expenses).values({
        clientId,
        scenarioId,
        type: "living",
        name: "Retirement Living Expenses",
        annualAmount: amount,
        startYear: primaryDobYear + (payload.goals.clientRetirementAge ?? client.retirementAge),
        startYearRef: "client_retirement",
        endYear: planEndYear,
        endYearRef: "plan_end",
        growthRate: "0.03",
        isDefault: true,
      });
    }
  }

  return result;
}

/**
 * Apply a submitted intake form to its existing client. Idempotent + atomic.
 */
export async function applyIntake(args: {
  formId: string;
  firmId: string;
  actorId: string;
}): Promise<{ clientId: string }> {
  const { formId, firmId, actorId } = args;

  const form = await loadFormForFirm(formId, firmId);
  if (!form) throw new Error(`Intake form ${formId} not found in firm ${firmId}`);
  if (!form.clientId) {
    // Existing-client path only — a form with no client is the prospect path
    // (next task), handled elsewhere.
    throw new Error(`Intake form ${formId} has no clientId (prospect path)`);
  }

  // Idempotency guard: only a freshly submitted form applies. Anything else
  // (applied/discarded/expired/draft) is a no-op.
  if (form.status !== "submitted") {
    return { clientId: form.clientId };
  }

  const clientId = form.clientId;
  const payload = intakeSubmitSchema.parse(form.payload);

  const applied = await db.transaction(async (tx) => {
    // Resolve the base-case scenario directly (no Clerk auth() outside a request).
    const [baseScenario] = await tx
      .select({ id: scenarios.id })
      .from(scenarios)
      .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)))
      .limit(1);
    if (!baseScenario) {
      throw new Error(`No base-case scenario for client ${clientId}`);
    }

    const sectionResult = await applySectionsToClient(
      tx,
      clientId,
      baseScenario.id,
      firmId,
      actorId,
      payload,
      { mode: "merge" },
    );

    await tx
      .update(intakeForms)
      .set({ status: "applied", appliedAt: new Date(), updatedAt: new Date() })
      .where(eq(intakeForms.id, formId));

    return sectionResult;
  });

  // ── Audits (best-effort, post-commit, on the global db) ───────────────────
  for (const id of applied.accountIds) {
    await recordCreate({
      action: "account.create",
      resourceType: "account",
      resourceId: id,
      clientId,
      firmId,
      actorId,
      actorKind: "advisor",
      snapshot: {},
      extraMetadata: { via: "intake.apply", formId },
    });
  }
  for (const id of applied.incomeIds) {
    await recordCreate({
      action: "income.create",
      resourceType: "income",
      resourceId: id,
      clientId,
      firmId,
      actorId,
      actorKind: "advisor",
      snapshot: {},
      extraMetadata: { via: "intake.apply", formId },
    });
  }
  for (const id of applied.childIds) {
    await recordCreate({
      action: "family_member.create",
      resourceType: "family_member",
      resourceId: id,
      clientId,
      firmId,
      actorId,
      actorKind: "advisor",
      snapshot: { role: "child" },
      extraMetadata: { via: "intake.apply", formId },
    });
  }
  if (applied.familyScalarsChanged) {
    await recordUpdate({
      action: "client.base_facts.update",
      resourceType: "client",
      resourceId: clientId,
      clientId,
      firmId,
      actorId,
      actorKind: "advisor",
      before: {},
      after: { source: "intake.apply" },
      fieldLabels: {},
      extraMetadata: { via: "intake.apply", formId },
    });
  }

  await recordAudit({
    action: "intake.form.applied",
    resourceType: "intake_form",
    resourceId: formId,
    clientId,
    firmId,
    actorId,
    actorKind: "advisor",
    metadata: {
      accounts: applied.accountIds.length,
      incomes: applied.incomeIds.length,
      children: applied.childIds.length,
    },
  });

  return { clientId };
}

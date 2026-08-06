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
 * Two paths, one transaction shape:
 *   - EXISTING-CLIENT (merge): form.clientId is set. Resolve the base scenario,
 *     applySectionsToClient(..., { mode: "merge" }) — family scalars UPDATE,
 *     accounts/incomes/children APPEND.
 *   - PROSPECT (fresh): form.clientId is null. Create the household + CRM
 *     contacts + client + base scenario from the staged payload (all on the same
 *     tx, no nested transaction), then applySectionsToClient(..., { mode:
 *     "fresh" }) and back-fill form.clientId. The whole tree is built atomically.
 *
 * Both paths emit the SAME post-commit audits: per-entity recordCreate/
 * recordUpdate plus the "intake.form.applied" summary (see emitApplyAudits).
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
  liabilities,
  planSettings,
  scenarios,
} from "@/db/schema";
import {
  intakeSubmitSchemaFor,
  maritalToFilingStatus,
  type IntakePayload,
} from "@/lib/intake/schema";
import { sectionsForForm, type IntakeSectionKey } from "@/lib/intake/sections";
import {
  childIndexFromRef,
  goalExpenseType,
  goalTopicLabel,
  goalYearWindow,
} from "@/lib/intake/goal-rows";
import { loadFormForFirm } from "@/lib/intake/queries";
import { incomeYearWindow } from "@/lib/intake/income-years";
import { buildClientMilestones } from "@/lib/milestones";
import {
  loadFamilyRoleIds,
  synthesizeAccountOwners,
  synthesizeLiabilityOwners,
} from "@/lib/imports/commit/family-resolver";
import { createClientForHousehold } from "@/lib/clients/create-client";
import { recordAudit, recordCreate, recordUpdate } from "@/lib/audit";
import { recordActivityNonFatal } from "@/lib/crm/activity";
import { syncHouseholdNameFromContacts } from "@/lib/crm/sync-household-name";
import { deriveHouseholdNameFromContacts } from "@/lib/crm/household-name";
import { upsertPrimaryAndSpouseContacts } from "@/lib/crm/upsert-household-contact";

// Drizzle transaction handle — same convention as create-client.ts / ownership.ts.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];


/** What applySectionsToClient inserted/changed — drives audits + a no-op guard. */
type ApplyResult = {
  accountIds: string[];
  incomeIds: string[];
  childIds: string[];
  /** Carried out so the post-commit CRM note doesn't have to re-query for it. */
  crmHouseholdId: string;
  // Property fans out beyond its account row: an insurance expense and a
  // mortgage liability, each audited like the account itself.
  expenseIds: string[];
  liabilityIds: string[];
  familyScalarsChanged: boolean;
};

/**
 * Resolve a goal's "who is this for" ref to a family_members id.
 *
 * The form carries a structural ref rather than a name (see `goal-rows.ts`), so
 * this is a direct lookup with nothing to disambiguate: children match by
 * POSITION, and `childIds` was pushed in payload order moments earlier, so the
 * index the client picked IS the row apply just wrote.
 *
 * Null for a ref pointing at somebody who isn't there — `forFamilyMemberId` is
 * attribution only, so the projection is identical either way and the advisor
 * re-points it during review.
 */
function beneficiaryId(
  ref: string | undefined,
  childIds: string[],
  familyRoleIds: { clientFmId: string | null; spouseFmId: string | null },
): string | null {
  if (!ref) return null;
  if (ref === "client") return familyRoleIds.clientFmId;
  if (ref === "spouse") return familyRoleIds.spouseFmId;
  const index = childIndexFromRef(ref);
  return index === null ? null : (childIds[index] ?? null);
}

/**
 * Date of birth of the household's primary contact. Only reached when the form
 * did not collect a Family step, which the create route permits ONLY for an
 * existing client — so a contact row exists. Throwing on a missing or
 * date-less contact is correct: silently guessing a birth year would place
 * every milestone-anchored row on the wrong calendar.
 *
 * Returns the DATE, not just its year: the year alone anchors `planEndYear`,
 * but `buildClientMilestones` (which places every retirement-anchored income
 * row) wants the full date, and the two must not come from different sources.
 */
async function primaryDobFromCrm(tx: Tx, householdId: string | null): Promise<string> {
  if (!householdId) {
    throw new Error("Cannot apply a family-less intake form: client has no CRM household");
  }
  const [contact] = await tx
    .select({ dateOfBirth: crmHouseholdContacts.dateOfBirth })
    .from(crmHouseholdContacts)
    .where(
      and(
        eq(crmHouseholdContacts.householdId, householdId),
        eq(crmHouseholdContacts.role, "primary"),
      ),
    )
    .limit(1);
  if (!contact?.dateOfBirth) {
    throw new Error(
      `Cannot apply a family-less intake form: household ${householdId} has no primary date of birth`,
    );
  }
  return contact.dateOfBirth;
}

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
  // Which sections the form actually collected. Every block below is gated on
  // this: a PREFILLED form seeds its payload from a plan snapshot, so a send
  // with Accounts excluded still carries seeded rows the client never saw, and
  // applying them would write stale snapshot data back over the live plan.
  sections: readonly IntakeSectionKey[],
  // opts.mode is reserved for the prospect path; the merge/fresh logic is
  // identical today (see the doc comment above).
  _opts: { mode: "merge" | "fresh" },
): Promise<ApplyResult> {
  void _opts; // reserved for the prospect path (next task); see doc comment.
  // ── Resolve the client row (need crmHouseholdId + planEndAge) ─────────────
  const [client] = await tx
    .select()
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  if (!client) throw new Error(`Client ${clientId} not found`);

  const result: ApplyResult = {
    accountIds: [],
    incomeIds: [],
    childIds: [],
    crmHouseholdId: client.crmHouseholdId,
    expenseIds: [],
    liabilityIds: [],
    familyScalarsChanged: false,
  };

  const primary = payload.family?.primary;
  const spouse = payload.family?.spouse;
  const now = new Date();
  const currentYear = now.getFullYear();
  // 1-indexed, matching liabilities.start_month / balance_as_of_month.
  const currentMonth = now.getMonth() + 1;

  // The projection horizon is anchored to the primary's birth year. A form that
  // did not collect Family has none, so fall back to the CRM contact the client
  // already has — `clients` carries no birth date of its own, only planEndAge.
  const primaryDob = primary?.dateOfBirth ?? (await primaryDobFromCrm(tx, client.crmHouseholdId));
  const primaryDobYear = new Date(primaryDob).getFullYear();
  const planEndYear = primaryDobYear + client.planEndAge;

  // The ages this apply is settling on — written to the client row below and
  // used to place every milestone-anchored row. One source so the anchors can't
  // disagree with the retirement age actually persisted.
  const clientRetirementAge = payload.goals.clientRetirementAge ?? client.retirementAge;
  const spouseRetirementAge =
    payload.goals.spouseRetirementAge ?? client.spouseRetirementAge;

  // ── Family scalars ────────────────────────────────────────────────────────
  // Primary + spouse CRM contacts (source of truth) via the shared upsert: the
  // primary always exists so it UPDATEs; a spouse is INSERTED when the household
  // started single (single→married), UPDATEd otherwise. This is the same helper
  // the AI-import commit and the manual PUT route through, so the three paths
  // can't drift.
  if (sections.includes("family") && primary) {
    await upsertPrimaryAndSpouseContacts(
      tx,
      client.crmHouseholdId,
      {
        primary: {
          firstName: primary.firstName,
          lastName: primary.lastName,
          dateOfBirth: primary.dateOfBirth,
          maritalStatus: primary.maritalStatus ?? null,
        },
        spouse: spouse
          ? {
              firstName: spouse.firstName,
              lastName: spouse.lastName,
              dateOfBirth: spouse.dateOfBirth,
              maritalStatus: spouse.maritalStatus ?? null,
            }
          : undefined,
      },
      primary.lastName,
    );
    result.familyScalarsChanged = true;

    // Primary rename, spouse rename, and first-time spouse insert all land above
    // and all change the derived household label. One sync covers all three.
    await syncHouseholdNameFromContacts(tx, client.crmHouseholdId);

    // Household residence state.
    if (payload.family?.stateOfResidence) {
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
        retirementAge: clientRetirementAge,
        spouseRetirementAge,
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
  }

  // ── Children ──────────────────────────────────────────────────────────────
  // v1 APPENDS each child (no dedup) — the advisor reviews per form, so a
  // re-sent form's children are expected to be net-new. Dedup deferred.
  if (sections.includes("family")) {
    for (const child of payload.family?.children ?? []) {
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
  }

  // Resolved outside every gate below: Accounts, Property, and the funded-goal
  // beneficiary lookup all need it, so a form that skips Accounts must still be
  // able to place an owned property or a goal pointed at the spouse.
  const familyRoleIds = await loadFamilyRoleIds(tx, clientId);

  // ── Accounts ──────────────────────────────────────────────────────────────
  // The form's owner enum (client/spouse/joint) becomes account_owners rows via
  // the coarse synthesis shared with the AI-import commit, so an intake account
  // never lands ownerless. Retirement is passed as non-joint because a
  // retirement account is singly owned — note the DB's retirement trigger keys
  // on sub_type and so never fires on these rows (we write sub_type "other").
  if (sections.includes("accounts")) {
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
          basis: String(account.basis ?? 0),
          custodian: account.custodian ?? null,
          source: "manual",
        })
        .returning({ id: accounts.id });
      result.accountIds.push(row.id);
      await synthesizeAccountOwners(
        tx,
        row.id,
        account.owner,
        familyRoleIds,
        account.category === "retirement",
      );
    }
  }

  // ── Income ────────────────────────────────────────────────────────────────
  // The form collects a start year, and either an end year or an "ends at
  // retirement" box. A retirement-ending row is written with an `endYearRef` so
  // it follows the retirement age the advisor settles on rather than freezing
  // the year the client happened to submit. Rows from before those fields
  // existed carry no years and fall back to currentYear → planEndYear.
  // Same milestone table the projection loader resolves against, so the year
  // stored here is the one `resolveRefYears` recomputes on load. `plan_start` is
  // unused by income anchors; currentYear stands in for it.
  if (sections.includes("income")) {
    const milestones = buildClientMilestones(
      {
        dateOfBirth: primaryDob,
        retirementAge: clientRetirementAge,
        planEndAge: client.planEndAge,
        spouseDob: spouse?.dateOfBirth ?? null,
        spouseRetirementAge,
      },
      currentYear,
      planEndYear,
    );
    for (const income of payload.income) {
      const window = incomeYearWindow(income, milestones, {
        currentYear,
        planEndYear,
      });
      const [row] = await tx
        .insert(incomes)
        .values({
          clientId,
          scenarioId,
          type: income.type,
          name: income.name,
          annualAmount: String(income.annualAmount),
          owner: income.owner,
          startYear: window.startYear,
          endYear: window.endYear,
          endYearRef: window.endYearRef,
          source: "manual",
        })
        .returning({ id: incomes.id });
      result.incomeIds.push(row.id);
    }
  }

  // ── Property (real_estate / business) → accounts (+ expense, + liability) ──
  //
  // A property row can fan out to three tables:
  //   accounts     — always. Carries the value, the cost basis, and (real
  //                  estate only) the annual property tax, which the projection
  //                  turns into its own synthetic expense.
  //   expenses     — when insurance was given. Property tax has a column;
  //                  insurance does not, so it lands as an ordinary recurring
  //                  expense running to plan end and growing with inflation.
  //   liabilities  — when a mortgage with a balance was declared.
  if (sections.includes("property")) {
    for (const property of payload.property) {
      const isRealEstate = property.kind === "real_estate";
      const [row] = await tx
        .insert(accounts)
        .values({
          clientId,
          scenarioId,
          name: property.name,
          category: property.kind,
          subType: "other",
          value: String(property.value),
          basis: String(property.basis ?? 0),
          // Real estate only: the engine reads this column for `real_estate`
          // accounts and ignores it everywhere else, and the form asks
          // accordingly. Left at the column default (0) when unanswered.
          ...(isRealEstate && property.annualPropertyTax != null
            ? { annualPropertyTax: String(property.annualPropertyTax) }
            : {}),
          source: "manual",
        })
        .returning({ id: accounts.id });
      result.accountIds.push(row.id);
      // Property is never a retirement account, so joint always splits 50/50.
      await synthesizeAccountOwners(tx, row.id, property.owner, familyRoleIds, false);

      // Insurance → its own expense row. Typed "insurance" so it reports in the
      // cash-flow Insurance bucket alongside modeled premiums.
      if (isRealEstate && property.annualInsurance) {
        const [expenseRow] = await tx
          .insert(expenses)
          .values({
            clientId,
            scenarioId,
            type: "insurance",
            name: `Insurance – ${property.name}`,
            annualAmount: String(property.annualInsurance),
            startYear: currentYear,
            endYear: planEndYear,
            endYearRef: "plan_end",
            growthRate: "0.03",
            growthSource: "inflation",
            source: "manual",
          })
          .returning({ id: expenses.id });
        result.expenseIds.push(expenseRow.id);
      }

      // Mortgage → a liability linked back to the property it encumbers.
      //
      // The form asks what a client knows — balance left and years left — but the
      // schedule is built from an origination year plus a full term. Anchoring the
      // loan at today makes the two equivalent: elapsed months is zero, so
      // buildLiabilitySchedule amortizes exactly the declared balance over exactly
      // the declared remaining years.
      //
      // A balance is the one field we can't amortize without, so it gates the
      // write; the advisor still sees the declared mortgage on the review screen
      // when it's missing.
      //
      // `isInterestDeductible` is set true rather than left at the column default:
      // mortgage interest on a residence is deductible, and starting from the
      // common case means the advisor corrects the exception (a rental, where the
      // interest is a Schedule E offset instead) rather than remembering to tick
      // the box on every intake. Note this feeds the itemized-deduction path, so
      // it does move tax results — it is why the review screen shows the mortgage
      // before anything is applied.
      const mortgage = isRealEstate ? property.mortgage : undefined;
      if (mortgage?.balance) {
        const [liabilityRow] = await tx
          .insert(liabilities)
          .values({
            clientId,
            scenarioId,
            name: `Mortgage – ${property.name}`,
            balance: String(mortgage.balance),
            balanceAsOfMonth: currentMonth,
            balanceAsOfYear: currentYear,
            interestRate: String((mortgage.interestRatePct ?? 0) / 100),
            monthlyPayment: String(mortgage.monthlyPayment ?? 0),
            startYear: currentYear,
            startMonth: currentMonth,
            termMonths: Math.round((mortgage.yearsRemaining ?? 0) * 12),
            termUnit: "annual",
            linkedPropertyId: row.id,
            liabilityType: "mortgage",
            isInterestDeductible: true,
          })
          .returning({ id: liabilities.id });
        result.liabilityIds.push(liabilityRow.id);
        await synthesizeLiabilityOwners(
          tx,
          liabilityRow.id,
          property.owner,
          familyRoleIds,
        );
      }
    }
  }

  // ── Funded goals → goal-flagged expenses ─────────────────────────────────
  //
  // The form's seven client-facing goal types collapse to the DB's two relevant
  // ones: "education" (always a goal — see `lib/goals.ts`) and "other" for
  // everything else, flagged `isGoal` so the Household Map's Goals board and the
  // wizard's step status pick it up. The specific flavour (wedding vs vehicle vs
  // travel) survives in the row's name, which is what the client typed.
  //
  // `inflationStartYear` is the plan start, NOT the goal's own start year. That
  // is the "today's dollars" default the advisor-side expense dialog writes, and
  // it is what makes the step's promise true: a client who types today's college
  // price gets a row that inflates to the year the goal actually lands. Anchoring
  // at the goal year instead would silently read the number as nominal-at-2032
  // and understate every goal.
  //
  // The basis year comes from the PERSISTED plan start, not the wall clock: an
  // existing client's plan may have started in an earlier year, and inflating a
  // today's-dollars goal from this year instead would quietly shave off every
  // year between the two. Falls back to the current year only when a scenario
  // somehow has no plan_settings row.
  if (sections.includes("goals") && payload.goals.expenseGoals.length > 0) {
    const [settings] = await tx
      .select({ planStartYear: planSettings.planStartYear })
      .from(planSettings)
      .where(
        and(
          eq(planSettings.clientId, clientId),
          eq(planSettings.scenarioId, scenarioId),
        ),
      )
      .limit(1);
    const planStartYear = settings?.planStartYear ?? currentYear;

    for (const goal of payload.goals.expenseGoals) {
      const window = goalYearWindow(goal, currentYear);
      const [row] = await tx
        .insert(expenses)
        .values({
          clientId,
          scenarioId,
          type: goalExpenseType(goal.type),
          name: goal.name,
          annualAmount: String(goal.amount),
          startYear: window.startYear,
          endYear: window.endYear,
          growthRate: "0.03",
          growthSource: "inflation",
          inflationStartYear: planStartYear,
          isGoal: true,
          forFamilyMemberId: beneficiaryId(goal.forWhom, result.childIds, familyRoleIds),
        })
        .returning({ id: expenses.id });
      result.expenseIds.push(row.id);
    }
  }

  // ── Retirement expenses ───────────────────────────────────────────────────
  // Only touch the retirement-living row when the form supplied an amount.
  if (sections.includes("goals") && payload.goals.annualRetirementExpenses != null) {
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
        // Default living expenses grow with inflation (matches create-client seed).
        growthRate: "0.03",
        growthSource: "inflation",
        isDefault: true,
      });
    }
  }

  return result;
}

/**
 * The "On your radar" answers as a CRM note body, or null when the client
 * checked nothing and wrote nothing.
 *
 * These are deliberately NOT expense rows. A checked box carries no amount and
 * no date, so projecting one would mean inventing both; what the client has
 * given us is an agenda for the first conversation. The household timeline is
 * where that belongs — and unlike the staged form payload (which the advisor
 * only sees while the form sits in review), a note survives the apply and is
 * still there at the next meeting.
 */
function radarNoteBody(goals: IntakePayload["goals"]): string | null {
  const topics = goals.topics.map((t) => `• ${goalTopicLabel(t)}`).join("\n");
  const note = goals.topicsNote?.trim();
  return [topics, note].filter(Boolean).join("\n\n") || null;
}

/**
 * File the "On your radar" answers on the household timeline. Post-commit and
 * best-effort, exactly like the audits beside it: the note narrates an apply
 * that already succeeded, so a timeline failure must not report a false error
 * for durable writes. Routed through `recordActivity` rather than a raw insert
 * so the row gets the same actor-name snapshot every other CRM note has — that
 * is what keeps the author's name on it after they leave the firm.
 */
async function emitRadarNote(args: {
  applied: ApplyResult;
  payload: IntakePayload;
  actorId: string;
}): Promise<void> {
  const body = radarNoteBody(args.payload.goals);
  if (!body) return;
  await recordActivityNonFatal(
    {
      householdId: args.applied.crmHouseholdId,
      kind: "note",
      title: "Goals to discuss (from intake)",
      body,
      occurredAt: new Date(),
    },
    { actorUserId: args.actorId },
    "intake-apply",
  );
}

/**
 * Emit the post-commit audit trail for an applied form. Best-effort, on the
 * global db, identical for both the merge and prospect paths: per-entity
 * recordCreate (accounts/incomes/children), a recordUpdate for the family
 * scalars, and the "intake.form.applied" summary. Hoisted so the prospect path
 * fires the SAME audits as the existing-client path (the section ids come back
 * from applySectionsToClient regardless of which path created the client).
 */
async function emitApplyAudits(args: {
  applied: ApplyResult;
  clientId: string;
  firmId: string;
  actorId: string;
  formId: string;
}): Promise<void> {
  const { applied, clientId, firmId, actorId, formId } = args;

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
  for (const id of applied.expenseIds) {
    await recordCreate({
      action: "expense.create",
      resourceType: "expense",
      resourceId: id,
      clientId,
      firmId,
      actorId,
      actorKind: "advisor",
      snapshot: {},
      extraMetadata: { via: "intake.apply", formId },
    });
  }
  for (const id of applied.liabilityIds) {
    await recordCreate({
      action: "liability.create",
      resourceType: "liability",
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
      expenses: applied.expenseIds.length,
      liabilities: applied.liabilityIds.length,
    },
  });
}

/**
 * Apply a submitted intake form. Idempotent + atomic. Two paths:
 *  - form.clientId set  → existing-client (merge) onto the base scenario.
 *  - form.clientId null → prospect: create household + contacts + client + base
 *    scenario from the payload, then apply the sections (mode "fresh").
 */
export async function applyIntake(args: {
  formId: string;
  firmId: string;
  actorId: string;
}): Promise<{ clientId: string }> {
  const { formId, firmId, actorId } = args;

  const form = await loadFormForFirm(formId, firmId);
  if (!form) throw new Error(`Intake form ${formId} not found in firm ${firmId}`);

  // Idempotency guard governs BOTH paths: only a freshly submitted form applies.
  // Anything else (applied/discarded/expired/draft) is a no-op. The prospect
  // branch back-fills clientId in the same tx as the status flip, so a re-apply
  // sees "applied" and short-circuits here before re-creating anything.
  if (form.status !== "submitted") {
    return { clientId: form.clientId ?? "" };
  }

  const sections = sectionsForForm(form.sections);
  const payload = intakeSubmitSchemaFor(sections).parse(form.payload);

  // ── Prospect path: no client yet — build the whole tree, then apply. ──────
  if (!form.clientId) {
    const { clientId, applied } = await db.transaction(async (tx) => {
      const family = payload.family;
      if (!family) {
        // Unreachable: the create route forces `family` into the section set
        // for any send with no clientId, so a prospect form cannot be persisted
        // without it. Explicit rather than a `!` so a future change to that
        // rule fails loudly here instead of inserting a nameless household.
        throw new Error(`Prospect intake form ${formId} has no family payload`);
      }
      const { primary, spouse } = family;

      // 1. Household — leave status at the enum default ("prospect").
      //    This derive is defense-in-depth, not the source of truth for the
      //    final name: applySectionsToClient (step 4 below) calls
      //    syncHouseholdNameFromContacts against the contact rows inserted in
      //    step 2, in this same transaction, and that sync overwrites
      //    whatever name lands here. Deriving it now means the row is never
      //    even transiently wrong, and keeps this correct on its own
      //    if the sync call in applySectionsToClient is ever moved.
      const derivedName =
        deriveHouseholdNameFromContacts([
          { role: "primary", firstName: primary.firstName, lastName: primary.lastName },
          ...(spouse
            ? [{ role: "spouse", firstName: spouse.firstName, lastName: spouse.lastName }]
            : []),
        ]) ?? `${primary.lastName} Household`;

      // Find-or-create: a prospect who uploaded a document before submitting
      // already has a household, minted by resolveIntakeHousehold and parked on
      // the form (see src/lib/intake/documents.ts). Inserting a second one here
      // would strand those documents on an orphan record no client points at.
      let householdId: string;
      if (form.crmHouseholdId) {
        householdId = form.crmHouseholdId;
        // The upload path only had recipientName to go on, and never knew the
        // state. Now that the real payload exists, overwrite both. Scoped by
        // firmId as well as id: resolveIntakeHousehold mints against the form's
        // own firm so the two always agree, but this is a write to a firm-owned
        // table and never gets to rely on that agreement holding.
        //
        // The `.returning()` is the point of the guard, not a convenience: an
        // UPDATE that matches nothing is silent, so without it a parked id from
        // another firm would skip the rename and then fall straight through to
        // wiring this firm's contacts and client onto that foreign household.
        // Throwing inside the transaction rolls the whole apply back.
        const updated = await tx
          .update(crmHouseholds)
          .set({
            name: derivedName,
            state: family.stateOfResidence ?? null,
            updatedAt: new Date(),
          })
          .where(and(eq(crmHouseholds.id, householdId), eq(crmHouseholds.firmId, firmId)))
          .returning({ id: crmHouseholds.id });
        if (updated.length === 0) {
          throw new Error(
            `Intake form ${formId} parks household ${householdId} outside firm ${firmId}`,
          );
        }
      } else {
        const [inserted] = await tx
          .insert(crmHouseholds)
          .values({
            firmId,
            advisorId: form.createdByUserId,
            name: derivedName,
            state: family.stateOfResidence ?? null,
          })
          .returning({ id: crmHouseholds.id });
        householdId = inserted.id;
      }

      // 2. CRM contacts — primary (carries recipientEmail), spouse if present.
      await tx.insert(crmHouseholdContacts).values({
        householdId,
        role: "primary",
        firstName: primary.firstName,
        lastName: primary.lastName,
        dateOfBirth: primary.dateOfBirth,
        maritalStatus: primary.maritalStatus ?? null,
        email: form.recipientEmail,
      });
      if (spouse) {
        await tx.insert(crmHouseholdContacts).values({
          householdId,
          role: "spouse",
          firstName: spouse.firstName,
          lastName: spouse.lastName,
          dateOfBirth: spouse.dateOfBirth,
          maritalStatus: spouse.maritalStatus ?? null,
        });
      }

      // 3. Client + base scenario + default rows. createClientForHousehold runs
      //    every insert on the supplied tx (no nested transaction), so this is
      //    atomic with the household/contacts above and the sections below.
      const { clientId, scenarioId } = await createClientForHousehold({
        household: {
          id: householdId,
          firmId,
          advisorId: form.createdByUserId,
          state: family.stateOfResidence ?? null,
        },
        primaryContact: {
          firstName: primary.firstName,
          lastName: primary.lastName,
          dateOfBirth: primary.dateOfBirth,
        },
        spouseContact: spouse
          ? {
              firstName: spouse.firstName,
              lastName: spouse.lastName,
              dateOfBirth: spouse.dateOfBirth,
            }
          : null,
        retirementAge: payload.goals.clientRetirementAge ?? 65,
        lifeExpectancy: 95,
        spouseRetirementAge:
          payload.goals.spouseRetirementAge ?? (spouse ? 65 : null),
        filingStatus: maritalToFilingStatus(primary.maritalStatus),
        tx,
      });

      // 4. Apply the staged sections onto the just-created client/scenario.
      const sectionResult = await applySectionsToClient(
        tx,
        clientId,
        scenarioId,
        firmId,
        actorId,
        payload,
        sections,
        { mode: "fresh" },
      );

      // 5. Back-fill clientId + flip status, all in the same tx.
      await tx
        .update(intakeForms)
        .set({
          clientId,
          status: "applied",
          appliedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(intakeForms.id, formId));

      return { clientId, applied: sectionResult };
    });

    await emitApplyAudits({ applied, clientId, firmId, actorId, formId });
    await emitRadarNote({ applied, payload, actorId });
    return { clientId };
  }

  // ── Existing-client path: merge onto the base scenario. ───────────────────
  const clientId = form.clientId;

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
      sections,
      { mode: "merge" },
    );

    await tx
      .update(intakeForms)
      .set({ status: "applied", appliedAt: new Date(), updatedAt: new Date() })
      .where(eq(intakeForms.id, formId));

    return sectionResult;
  });

  await emitApplyAudits({ applied, clientId, firmId, actorId, formId });
  await emitRadarNote({ applied, payload, actorId });
  return { clientId };
}

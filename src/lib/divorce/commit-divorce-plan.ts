// Divorce commit engine (Tasks 9–12). One-way: freezes a pre-divorce baseline
// snapshot, mints the spouse's CRM household + planning client, and re-homes the
// allocated objects onto that new file, then finalizes the draft as committed.
//
// This is Task 9 — the scaffold: preconditions, snapshot, mint the spouse side,
// and the family-member remap. Tasks 10–12 grow the transaction body (account/
// income/expense/liability/entity moves + splits, ride-alongs, cleanup, the CRM
// ex_spouse edge, and the audit/activity records) at the marked seam.
//
// STRUCTURE. Two side effects are created BEFORE the atomic transaction because
// their writers run on the module `db` (their own connection) and can't join our
// `tx`: the snapshot (createSnapshot) and the spouse CRM household
// (createCrmHousehold, which also resolves the firm via Clerk auth). This mirrors
// promote-to-base.ts, which snapshots before its transaction and compensating-
// deletes on failure. Everything that CAN be atomic — the concurrency guard, the
// spouse client mint (createClientForHousehold accepts our tx), the family-member
// copies, and the finalize — runs inside a single db.transaction. On any failure
// the pre-tx household + snapshot are compensating-deleted; the household is safe
// to drop because the rolled-back tx never created its client (crmHouseholdId is
// ON DELETE RESTRICT).
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  divorcePlans,
  divorcePlanAllocations,
  clients,
  crmHouseholds,
  crmHouseholdContacts,
  familyMembers,
  scenarioSnapshots,
  accounts,
  accountOwners,
  savingsRules,
  withdrawalStrategies,
  accountFlowOverrides,
  beneficiaryDesignations,
  externalBeneficiaries,
  revocableTrusts,
  incomes,
  expenses,
  liabilities,
  liabilityOwners,
  notesReceivable,
  noteReceivableOwners,
  gifts,
  giftSeries,
  medicareCoverage,
  wills,
  willBequests,
  willBequestRecipients,
  willResiduaryRecipients,
  transfers,
  reinvestments,
  reinvestmentAccounts,
  rothConversions,
  rothConversionSources,
  assetTransactions,
  expenseDedicatedAccounts,
} from "@/db/schema";
import { createSnapshot } from "@/lib/scenario/snapshot";
import { createCrmHousehold } from "@/lib/crm/households";
import { deriveHouseholdNameFromContacts } from "@/lib/crm/household-name";
import { createClientForHousehold } from "@/lib/clients/create-client";
import { isUSPSStateCode } from "@/lib/usps-states";
import {
  allocationKey,
  resolveAllocations,
  type ResolvedAllocation,
  type DivisibleObject,
} from "./allocation-rules";
import { loadDivisibleObjects } from "./divisible-objects";
import {
  buildCommitPreview,
  buildSideResolvers,
  linkEndpointSides,
  straddles,
  type CommitPreview,
  type Side,
} from "./commit-preview";

// Drizzle transaction handle — same convention as create-client.ts / ownership.ts.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class DivorceCommitError extends Error {
  code: "blocked" | "no_draft" | "concurrent";
  blockers?: CommitPreview["blockers"];
  constructor(
    code: DivorceCommitError["code"],
    message: string,
    blockers?: CommitPreview["blockers"],
  ) {
    super(message);
    this.code = code;
    this.name = "DivorceCommitError";
    if (blockers) this.blockers = blockers;
  }
}

export interface CommitResult {
  spouseClientId: string;
  spouseHouseholdId: string;
  spouseScenarioId: string;
  snapshotId: string;
  // Human-readable notes for every link/designation dropped or cross-side ref
  // cleared during the move (Task 12 also folds these into the audit record).
  warnings: string[];
}

// Mutable context threaded through the module-private step helpers. Tasks 10–12
// slot their steps in against this shape; each helper takes `(tx, ctx)`.
interface CommitCtx {
  plan: typeof divorcePlans.$inferSelect;
  objects: DivisibleObject[];
  resolved: Map<string, ResolvedAllocation>;
  // The two household principals' P-side family_member ids. `spouseFamilyMemberId`
  // is the remap source for the ex-spouse → S's role='client' row (Step 4);
  // `primaryFamilyMemberId` is its counterpart, used by the owner/designation
  // remaps in Tasks 10–12. Null spouse only in already-guarded, never-committed
  // states (commit requires a married client with a spouse contact).
  primaryFamilyMemberId: string;
  spouseFamilyMemberId: string | null;
  // P's Base Case scenario id — the source scenario every scenario-scoped row
  // (savings rules, flow overrides, transfers, gift series, …) re-points FROM.
  baseScenarioId: string;
  // Filled once the spouse side is minted (Step 3).
  spouseClientId: string;
  spouseScenarioId: string;
  spouseHouseholdId: string;
  // S's seeded role='client' family_member id (the re-homed ex-spouse). Every
  // moved object's ownership collapses onto this person. Filled in Step 4.
  spouseClientFamilyMemberId: string;
  fmRemap: Map<string, string>; // P family_member id → S family_member id
  extBenRemap: Map<string, string>; // lazy external_beneficiaries copies (Tasks 10–11)
  entityRemap: Map<string, string>; // filled by duplicate/move in Task 11
  warnings: string[]; // dropped-link names, for the audit record (Task 12)
}

/** Load the single live (status='draft') plan row for a client, org-scoped. */
async function loadLiveDraft(
  clientId: string,
  firmId: string,
): Promise<typeof divorcePlans.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(divorcePlans)
    .where(
      and(
        eq(divorcePlans.clientId, clientId),
        eq(divorcePlans.firmId, firmId),
        eq(divorcePlans.status, "draft"),
      ),
    );
  return row ?? null;
}

// Step 4 — family-member remap. Maps the ex-spouse's P family_member row to S's
// seeded role='client' row, then copies every child/other member allocated
// `duplicate` or `spouse` onto S (recording each in fmRemap). Members allocated
// `primary` stay on P only. Deletion of the spouse's P row + `spouse`-allocated
// P members happens in cleanup (Task 12).
async function mintSpouseFamilyMembers(tx: Tx, ctx: CommitCtx): Promise<void> {
  // S's role='client' row (seeded by createClientForHousehold) is the re-homed
  // ex-spouse — the owner every moved object collapses onto. Capture it always,
  // and map the ex-spouse's P family_member row onto it when one exists.
  const [sClientFm] = await tx
    .select({ id: familyMembers.id })
    .from(familyMembers)
    .where(and(eq(familyMembers.clientId, ctx.spouseClientId), eq(familyMembers.role, "client")))
    .limit(1);
  ctx.spouseClientFamilyMemberId = sClientFm?.id ?? "";
  if (ctx.spouseFamilyMemberId && sClientFm) {
    ctx.fmRemap.set(ctx.spouseFamilyMemberId, sClientFm.id);
  }

  const copyIds = ctx.objects
    .filter((o) => o.kind === "family_member")
    .filter((o) => {
      const disp = ctx.resolved.get(allocationKey("family_member", o.id))?.disposition;
      return disp === "duplicate" || disp === "spouse";
    })
    .map((o) => o.id);
  if (copyIds.length === 0) return;

  // Copy the source rows verbatim (identity + relationship + role), re-homed to S.
  for (const id of copyIds) {
    const [p] = await tx.select().from(familyMembers).where(eq(familyMembers.id, id)).limit(1);
    if (!p) continue;
    const [sFm] = await tx
      .insert(familyMembers)
      .values({
        clientId: ctx.spouseClientId,
        role: p.role,
        relationship: p.relationship,
        firstName: p.firstName,
        lastName: p.lastName,
        dateOfBirth: p.dateOfBirth,
        notes: p.notes,
      })
      .returning({ id: familyMembers.id });
    ctx.fmRemap.set(p.id, sFm.id);
  }
}

// ── Step 5: move mechanics + follow rules (Commit engine B) ──────────────────
//
// Re-homes every object the advisor allocated `spouse` onto S's file, applies
// the automatic grantor/owner-enum follows (gifts, medicare, wills), and drops
// the links that would straddle the two households. Entity moves + duplication
// (Rulebook entity/family_member rows) are Task 11 — the dispatch below leaves a
// slot for them. All writes go on `tx`; nothing here touches the module `db`.

/**
 * Copy-on-first-use of a P external_beneficiaries row onto S, memoized in
 * `ctx.extBenRemap`. Returns the S-side id (or the original when the row is
 * missing — defensive; a live commit always resolves it).
 */
async function ensureExternalBeneficiary(
  tx: Tx,
  ctx: CommitCtx,
  pId: string,
): Promise<string> {
  const memo = ctx.extBenRemap.get(pId);
  if (memo) return memo;
  const [p] = await tx
    .select()
    .from(externalBeneficiaries)
    .where(eq(externalBeneficiaries.id, pId))
    .limit(1);
  if (!p) return pId;
  const [s] = await tx
    .insert(externalBeneficiaries)
    .values({
      clientId: ctx.spouseClientId,
      name: p.name,
      kind: p.kind,
      charityType: p.charityType,
      notes: p.notes,
    })
    .returning({ id: externalBeneficiaries.id });
  ctx.extBenRemap.set(pId, s.id);
  return s.id;
}

interface OwnerValue {
  familyMemberId?: string;
  entityId?: string;
  externalBeneficiaryId?: string;
  percent: string;
}

/**
 * Owner rows for a moved object, re-pointed to S. Owners whose person/entity
 * reaches S are remapped and kept, re-normalized so the survivors sum to 100%
 * (fraction "1.0000"); owners staying on P are dropped. When nothing survives
 * (e.g. a solely-primary account awarded to the ex-spouse) the mover — S's
 * client — becomes the sole 100% owner, so a moved account is never ownerless.
 */
async function movedOwnerRows(
  tx: Tx,
  ctx: CommitCtx,
  rows: Array<{
    familyMemberId: string | null;
    entityId?: string | null;
    externalBeneficiaryId?: string | null;
    percent: string;
  }>,
): Promise<OwnerValue[]> {
  const survivors: Array<Omit<OwnerValue, "percent"> & { weight: number }> = [];
  for (const r of rows) {
    if (r.familyMemberId) {
      const mapped = ctx.fmRemap.get(r.familyMemberId);
      if (mapped) survivors.push({ familyMemberId: mapped, weight: Number(r.percent) });
    } else if (r.entityId) {
      const mapped = ctx.entityRemap.get(r.entityId);
      if (mapped) survivors.push({ entityId: mapped, weight: Number(r.percent) });
    } else if (r.externalBeneficiaryId) {
      const mapped = await ensureExternalBeneficiary(tx, ctx, r.externalBeneficiaryId);
      survivors.push({ externalBeneficiaryId: mapped, weight: Number(r.percent) });
    }
  }
  if (survivors.length === 0) {
    return [{ familyMemberId: ctx.spouseClientFamilyMemberId, percent: "1.0000" }];
  }
  const total = survivors.reduce((sum, x) => sum + x.weight, 0) || 1;
  return survivors.map((x) => ({
    familyMemberId: x.familyMemberId,
    entityId: x.entityId,
    externalBeneficiaryId: x.externalBeneficiaryId,
    percent: (x.weight / total).toFixed(4),
  }));
}

/** Find-or-create a same-name revocable_trusts tag on S for a moved account. */
async function findOrCreateRevocableTrust(
  tx: Tx,
  ctx: CommitCtx,
  pTrustId: string,
): Promise<string> {
  const [p] = await tx
    .select()
    .from(revocableTrusts)
    .where(eq(revocableTrusts.id, pTrustId))
    .limit(1);
  if (!p) return pTrustId;
  const [existing] = await tx
    .select({ id: revocableTrusts.id })
    .from(revocableTrusts)
    .where(and(eq(revocableTrusts.clientId, ctx.spouseClientId), eq(revocableTrusts.name, p.name)))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await tx
    .insert(revocableTrusts)
    .values({ clientId: ctx.spouseClientId, name: p.name })
    .returning({ id: revocableTrusts.id });
  return created.id;
}

/** Re-point + remap a moved account's beneficiary designations; drop the ones
 *  that named someone who can't reach S. */
async function moveAccountDesignations(
  tx: Tx,
  ctx: CommitCtx,
  obj: DivisibleObject,
): Promise<void> {
  const rows = await tx
    .select()
    .from(beneficiaryDesignations)
    .where(eq(beneficiaryDesignations.accountId, obj.id));
  for (const d of rows) {
    let familyMemberId = d.familyMemberId;
    let householdRole = d.householdRole;
    let externalBeneficiaryId = d.externalBeneficiaryId;
    let drop = false;

    if (householdRole) {
      // On S the mover (ex-spouse) is the client; a row naming the primary strands.
      if (householdRole === "spouse") householdRole = "client";
      else drop = true;
    } else if (familyMemberId) {
      const mapped = ctx.fmRemap.get(familyMemberId);
      if (mapped) familyMemberId = mapped;
      else drop = true;
    } else if (externalBeneficiaryId) {
      externalBeneficiaryId = await ensureExternalBeneficiary(tx, ctx, externalBeneficiaryId);
    }

    if (drop) {
      await tx.delete(beneficiaryDesignations).where(eq(beneficiaryDesignations.id, d.id));
      ctx.warnings.push(
        `Beneficiary designation on "${obj.label}" dropped — it named someone who stays with the other household.`,
      );
      continue;
    }
    await tx
      .update(beneficiaryDesignations)
      .set({
        clientId: ctx.spouseClientId,
        familyMemberId,
        householdRole,
        externalBeneficiaryId,
        // entity_id_ref names another entity; Task 11's entityRemap re-points it.
        entityIdRef: d.entityIdRef ? ctx.entityRemap.get(d.entityIdRef) ?? d.entityIdRef : null,
      })
      .where(eq(beneficiaryDesignations.id, d.id));
  }
}

/** Move an account + its ride-alongs onto S (Rulebook account `spouse` row). */
async function moveAccount(tx: Tx, ctx: CommitCtx, obj: DivisibleObject): Promise<void> {
  const [acct] = await tx.select().from(accounts).where(eq(accounts.id, obj.id)).limit(1);
  if (!acct) return;

  const remapFm = (id: string | null): string | null =>
    id ? ctx.fmRemap.get(id) ?? id : id;
  const revocableTrustId = acct.revocableTrustId
    ? await findOrCreateRevocableTrust(tx, ctx, acct.revocableTrustId)
    : null;

  await tx
    .update(accounts)
    .set({
      clientId: ctx.spouseClientId,
      scenarioId: ctx.spouseScenarioId,
      revocableTrustId,
      // S already has its own seeded default-checking account; a moved account
      // must never carry the flag in, or S would have two (the app assumes one
      // per client). Re-defaulting the P side is Task 12's problem.
      isDefaultChecking: false,
      // 529 grantor / beneficiary attributions ride to their S counterparts.
      grantorFamilyMemberId: remapFm(acct.grantorFamilyMemberId),
      beneficiaryFamilyMemberId: remapFm(acct.beneficiaryFamilyMemberId),
      updatedAt: new Date(),
    })
    .where(eq(accounts.id, obj.id));

  // account_owners → the mover (100%).
  const ownerRows = await tx.select().from(accountOwners).where(eq(accountOwners.accountId, obj.id));
  const survivors = await movedOwnerRows(tx, ctx, ownerRows);
  await tx.delete(accountOwners).where(eq(accountOwners.accountId, obj.id));
  if (survivors.length) {
    await tx.insert(accountOwners).values(
      survivors.map((s) => ({
        accountId: obj.id,
        familyMemberId: s.familyMemberId ?? null,
        entityId: s.entityId ?? null,
        externalBeneficiaryId: s.externalBeneficiaryId ?? null,
        percent: s.percent,
      })),
    );
  }

  // (clientId, scenarioId, accountId) ride-alongs follow the account.
  await tx
    .update(savingsRules)
    .set({ clientId: ctx.spouseClientId, scenarioId: ctx.spouseScenarioId })
    .where(eq(savingsRules.accountId, obj.id));
  await tx
    .update(withdrawalStrategies)
    .set({ clientId: ctx.spouseClientId, scenarioId: ctx.spouseScenarioId })
    .where(eq(withdrawalStrategies.accountId, obj.id));
  // Base-scenario flow overrides → base(S); null-scenario rows follow via FK.
  await tx
    .update(accountFlowOverrides)
    .set({ scenarioId: ctx.spouseScenarioId })
    .where(
      and(
        eq(accountFlowOverrides.accountId, obj.id),
        eq(accountFlowOverrides.scenarioId, ctx.baseScenarioId),
      ),
    );

  await moveAccountDesignations(tx, ctx, obj);
}

/** Move an income onto S; owner → client; cross-side cash account → null. */
async function moveIncome(
  tx: Tx,
  ctx: CommitCtx,
  obj: DivisibleObject,
  keepIfSpouse: (id: string | null) => string | null,
): Promise<void> {
  const [inc] = await tx.select().from(incomes).where(eq(incomes.id, obj.id)).limit(1);
  if (!inc) return;
  await tx
    .update(incomes)
    .set({
      clientId: ctx.spouseClientId,
      scenarioId: ctx.spouseScenarioId,
      owner: "client",
      cashAccountId: keepIfSpouse(inc.cashAccountId),
      updatedAt: new Date(),
    })
    .where(eq(incomes.id, obj.id));
}

/** Move an expense onto S; cross-side cash / policy accounts → null;
 *  forFamilyMemberId remap-or-null. */
async function moveExpense(
  tx: Tx,
  ctx: CommitCtx,
  obj: DivisibleObject,
  keepIfSpouse: (id: string | null) => string | null,
): Promise<void> {
  const [ex] = await tx.select().from(expenses).where(eq(expenses.id, obj.id)).limit(1);
  if (!ex) return;
  await tx
    .update(expenses)
    .set({
      clientId: ctx.spouseClientId,
      scenarioId: ctx.spouseScenarioId,
      cashAccountId: keepIfSpouse(ex.cashAccountId),
      sourcePolicyAccountId: keepIfSpouse(ex.sourcePolicyAccountId),
      forFamilyMemberId: ex.forFamilyMemberId ? ctx.fmRemap.get(ex.forFamilyMemberId) ?? null : null,
      updatedAt: new Date(),
    })
    .where(eq(expenses.id, obj.id));
}

/** Move a liability onto S; owners collapse to the mover; a cross-side secured
 *  property link is cleared with a warning. */
async function moveLiability(
  tx: Tx,
  ctx: CommitCtx,
  obj: DivisibleObject,
  accountSides: (id: string) => Set<Side>,
): Promise<void> {
  const [lib] = await tx.select().from(liabilities).where(eq(liabilities.id, obj.id)).limit(1);
  if (!lib) return;
  let linkedPropertyId = lib.linkedPropertyId;
  if (linkedPropertyId && !accountSides(linkedPropertyId).has("spouse")) {
    linkedPropertyId = null;
    ctx.warnings.push(
      `"${lib.name}": secured property stays with the other household — the property link was cleared.`,
    );
  }
  await tx
    .update(liabilities)
    .set({
      clientId: ctx.spouseClientId,
      scenarioId: ctx.spouseScenarioId,
      linkedPropertyId,
      updatedAt: new Date(),
    })
    .where(eq(liabilities.id, obj.id));

  const ownerRows = await tx
    .select()
    .from(liabilityOwners)
    .where(eq(liabilityOwners.liabilityId, obj.id));
  const survivors = await movedOwnerRows(tx, ctx, ownerRows);
  await tx.delete(liabilityOwners).where(eq(liabilityOwners.liabilityId, obj.id));
  if (survivors.length) {
    await tx.insert(liabilityOwners).values(
      survivors.map((s) => ({
        liabilityId: obj.id,
        familyMemberId: s.familyMemberId ?? null,
        entityId: s.entityId ?? null,
        percent: s.percent,
      })),
    );
  }
}

/** Move a note receivable onto S; owners collapse to the mover; a cross-side
 *  linked-trust reference is cleared with a warning. note_extra_payments ride
 *  via FK. */
async function moveNote(
  tx: Tx,
  ctx: CommitCtx,
  obj: DivisibleObject,
  entitySides: (id: string) => Set<Side>,
): Promise<void> {
  const [n] = await tx.select().from(notesReceivable).where(eq(notesReceivable.id, obj.id)).limit(1);
  if (!n) return;
  let linkedTrustEntityId = n.linkedTrustEntityId;
  if (linkedTrustEntityId && !entitySides(linkedTrustEntityId).has("spouse")) {
    linkedTrustEntityId = null;
    ctx.warnings.push(
      `"${n.name}": linked trust stays with the other household — the trust link was cleared.`,
    );
  }
  await tx
    .update(notesReceivable)
    .set({
      clientId: ctx.spouseClientId,
      scenarioId: ctx.spouseScenarioId,
      linkedTrustEntityId,
      updatedAt: new Date(),
    })
    .where(eq(notesReceivable.id, obj.id));

  const ownerRows = await tx
    .select()
    .from(noteReceivableOwners)
    .where(eq(noteReceivableOwners.noteReceivableId, obj.id));
  const survivors = await movedOwnerRows(tx, ctx, ownerRows);
  await tx.delete(noteReceivableOwners).where(eq(noteReceivableOwners.noteReceivableId, obj.id));
  if (survivors.length) {
    await tx.insert(noteReceivableOwners).values(
      survivors.map((s) => ({
        noteReceivableId: obj.id,
        familyMemberId: s.familyMemberId ?? null,
        entityId: s.entityId ?? null,
        externalBeneficiaryId: s.externalBeneficiaryId ?? null,
        percent: s.percent,
      })),
    );
  }
}

/**
 * Automatic grantor/owner-enum follows — not allocation-driven. A spouse-grantor
 * gift / gift series / will and a spouse-owned Medicare row belong to the
 * ex-spouse, so they re-home to S with the enum flipped to `client`. Recipient
 * family members remap through fmRemap (leave-as-is when the recipient stays a
 * live P member); will recipients naming a person who can't reach S are dropped.
 */
async function followGrantorEnums(tx: Tx, ctx: CommitCtx): Promise<void> {
  const P = ctx.plan.clientId;
  const S = ctx.spouseClientId;
  const remapFmKeep = (id: string | null): string | null =>
    id ? ctx.fmRemap.get(id) ?? id : null;
  const remapEntityKeep = (id: string | null): string | null =>
    id ? ctx.entityRemap.get(id) ?? id : null;

  // gifts (client-scoped).
  const giftRows = await tx
    .select()
    .from(gifts)
    .where(and(eq(gifts.clientId, P), eq(gifts.grantor, "spouse")));
  for (const g of giftRows) {
    await tx
      .update(gifts)
      .set({
        clientId: S,
        grantor: "client",
        recipientFamilyMemberId: remapFmKeep(g.recipientFamilyMemberId),
        recipientExternalBeneficiaryId: g.recipientExternalBeneficiaryId
          ? await ensureExternalBeneficiary(tx, ctx, g.recipientExternalBeneficiaryId)
          : null,
        recipientEntityId: remapEntityKeep(g.recipientEntityId),
        businessEntityId: remapEntityKeep(g.businessEntityId),
        updatedAt: new Date(),
      })
      .where(eq(gifts.id, g.id));
  }

  // gift_series (scenario-scoped).
  const gsRows = await tx
    .select()
    .from(giftSeries)
    .where(
      and(
        eq(giftSeries.clientId, P),
        eq(giftSeries.scenarioId, ctx.baseScenarioId),
        eq(giftSeries.grantor, "spouse"),
      ),
    );
  for (const gs of gsRows) {
    await tx
      .update(giftSeries)
      .set({
        clientId: S,
        scenarioId: ctx.spouseScenarioId,
        grantor: "client",
        recipientFamilyMemberId: remapFmKeep(gs.recipientFamilyMemberId),
        recipientExternalBeneficiaryId: gs.recipientExternalBeneficiaryId
          ? await ensureExternalBeneficiary(tx, ctx, gs.recipientExternalBeneficiaryId)
          : null,
        recipientEntityId: remapEntityKeep(gs.recipientEntityId),
        updatedAt: new Date(),
      })
      .where(eq(giftSeries.id, gs.id));
  }

  // medicare_coverage (owner enum).
  await tx
    .update(medicareCoverage)
    .set({ clientId: S, owner: "client", updatedAt: new Date() })
    .where(and(eq(medicareCoverage.clientId, P), eq(medicareCoverage.owner, "spouse")));

  // wills — flip grantor; bequests/residuary ride via FK, family-member
  // recipients remap-or-drop+warn.
  const willRows = await tx
    .select()
    .from(wills)
    .where(and(eq(wills.clientId, P), eq(wills.grantor, "spouse")));
  for (const w of willRows) {
    await tx
      .update(wills)
      .set({ clientId: S, grantor: "client", updatedAt: new Date() })
      .where(eq(wills.id, w.id));

    const bequestRecipients = await tx
      .select({ id: willBequestRecipients.id, recipientId: willBequestRecipients.recipientId })
      .from(willBequestRecipients)
      .innerJoin(willBequests, eq(willBequestRecipients.bequestId, willBequests.id))
      .where(
        and(eq(willBequests.willId, w.id), eq(willBequestRecipients.recipientKind, "family_member")),
      );
    for (const r of bequestRecipients) {
      const mapped = r.recipientId ? ctx.fmRemap.get(r.recipientId) : undefined;
      if (mapped) {
        await tx
          .update(willBequestRecipients)
          .set({ recipientId: mapped })
          .where(eq(willBequestRecipients.id, r.id));
      } else {
        await tx.delete(willBequestRecipients).where(eq(willBequestRecipients.id, r.id));
        ctx.warnings.push(
          "Will bequest recipient dropped — it named someone who stays with the other household.",
        );
      }
    }

    const residuaryRecipients = await tx
      .select({ id: willResiduaryRecipients.id, recipientId: willResiduaryRecipients.recipientId })
      .from(willResiduaryRecipients)
      .where(
        and(
          eq(willResiduaryRecipients.willId, w.id),
          eq(willResiduaryRecipients.recipientKind, "family_member"),
        ),
      );
    for (const r of residuaryRecipients) {
      const mapped = r.recipientId ? ctx.fmRemap.get(r.recipientId) : undefined;
      if (mapped) {
        await tx
          .update(willResiduaryRecipients)
          .set({ recipientId: mapped })
          .where(eq(willResiduaryRecipients.id, r.id));
      } else {
        await tx.delete(willResiduaryRecipients).where(eq(willResiduaryRecipients.id, r.id));
        ctx.warnings.push(
          "Will residuary recipient dropped — it named someone who stays with the other household.",
        );
      }
    }
  }
}

/**
 * Techniques that reference accounts (transfers, reinvestments, roth
 * conversions, asset transactions) and dedicated-funding join rows follow when
 * ALL their endpoints land on one household, and are DROPPED (itemized by name)
 * when they straddle. Straddle detection reuses commit-preview's shared
 * primitives so the preview's warnings and the commit's deletions can never
 * disagree.
 */
async function handleLinks(
  tx: Tx,
  ctx: CommitCtx,
  accountSides: (id: string) => Set<Side>,
): Promise<void> {
  const P = ctx.plan.clientId;
  const baseP = ctx.baseScenarioId;
  const toS = { clientId: ctx.spouseClientId, scenarioId: ctx.spouseScenarioId };
  const expenseSides = (id: string): Set<Side> =>
    linkEndpointSides(ctx.resolved.get(allocationKey("expense", id)));
  const followsSpouse = (sides: Set<Side>[]): boolean => {
    const present = sides.filter((s) => s.size > 0);
    return present.length > 0 && present.every((s) => s.has("spouse"));
  };

  // transfers.
  const transferRows = await tx
    .select()
    .from(transfers)
    .where(and(eq(transfers.clientId, P), eq(transfers.scenarioId, baseP)));
  for (const t of transferRows) {
    const sides = [accountSides(t.sourceAccountId), accountSides(t.targetAccountId)];
    if (straddles(sides)) {
      await tx.delete(transfers).where(eq(transfers.id, t.id));
      ctx.warnings.push(`Transfer "${t.name}" dropped — its accounts land on different households.`);
    } else if (followsSpouse(sides)) {
      await tx.update(transfers).set(toS).where(eq(transfers.id, t.id));
    }
  }

  // reinvestments (+ reinvestment_accounts ride via FK).
  const reinvRows = await tx
    .select()
    .from(reinvestments)
    .where(and(eq(reinvestments.clientId, P), eq(reinvestments.scenarioId, baseP)));
  for (const rv of reinvRows) {
    const accts = await tx
      .select({ accountId: reinvestmentAccounts.accountId })
      .from(reinvestmentAccounts)
      .where(eq(reinvestmentAccounts.reinvestmentId, rv.id));
    const sides = accts.map((a) => accountSides(a.accountId));
    if (straddles(sides)) {
      await tx.delete(reinvestments).where(eq(reinvestments.id, rv.id));
      ctx.warnings.push(
        `Reinvestment "${rv.name}" dropped — it spans accounts on different households.`,
      );
    } else if (followsSpouse(sides)) {
      await tx.update(reinvestments).set(toS).where(eq(reinvestments.id, rv.id));
    }
  }

  // roth_conversions (+ sources ride via FK).
  const rothRows = await tx
    .select()
    .from(rothConversions)
    .where(and(eq(rothConversions.clientId, P), eq(rothConversions.scenarioId, baseP)));
  for (const rc of rothRows) {
    const srcs = await tx
      .select({ accountId: rothConversionSources.accountId })
      .from(rothConversionSources)
      .where(eq(rothConversionSources.rothConversionId, rc.id));
    const sides = [accountSides(rc.destinationAccountId), ...srcs.map((s) => accountSides(s.accountId))];
    if (straddles(sides)) {
      await tx.delete(rothConversions).where(eq(rothConversions.id, rc.id));
      ctx.warnings.push(
        `Roth conversion "${rc.name}" dropped — its accounts land on different households.`,
      );
    } else if (followsSpouse(sides)) {
      await tx.update(rothConversions).set(toS).where(eq(rothConversions.id, rc.id));
    }
  }

  // asset_transactions.
  const assetRows = await tx
    .select()
    .from(assetTransactions)
    .where(and(eq(assetTransactions.clientId, P), eq(assetTransactions.scenarioId, baseP)));
  for (const at of assetRows) {
    const ids = [at.accountId, at.proceedsAccountId, at.fundingAccountId, at.businessAccountId].filter(
      (x): x is string => !!x,
    );
    if (ids.length === 0) continue;
    const sides = ids.map(accountSides);
    if (ids.length >= 2 && straddles(sides)) {
      await tx.delete(assetTransactions).where(eq(assetTransactions.id, at.id));
      ctx.warnings.push(`Buy/sell "${at.name}" dropped — it links accounts on different households.`);
    } else if (followsSpouse(sides)) {
      await tx.update(assetTransactions).set(toS).where(eq(assetTransactions.id, at.id));
    }
  }

  // expense_dedicated_accounts — drop a funding link straddling its goal; a
  // same-side join rides via FK (no scenario column to re-point).
  const poolExpenseIds = ctx.objects.filter((o) => o.kind === "expense").map((o) => o.id);
  if (poolExpenseIds.length) {
    const edaRows = await tx
      .select()
      .from(expenseDedicatedAccounts)
      .where(inArray(expenseDedicatedAccounts.expenseId, poolExpenseIds));
    for (const e of edaRows) {
      if (straddles([expenseSides(e.expenseId), accountSides(e.accountId)])) {
        await tx.delete(expenseDedicatedAccounts).where(eq(expenseDedicatedAccounts.id, e.id));
        ctx.warnings.push(
          "A dedicated funding account was dropped — it lands on a different household than its education goal.",
        );
      }
    }
  }
}

/**
 * Move every `spouse`-allocated account / income / expense / liability / note
 * onto S with its ride-alongs, apply the automatic grantor/owner-enum follows,
 * then follow-or-drop the technique links. Entity moves + duplication are Task
 * 11 — the `entity` / `family_member` arms are intentionally left to it.
 */
async function moveAllocatedObjects(tx: Tx, ctx: CommitCtx): Promise<void> {
  const { accountSides, entitySides } = buildSideResolvers(ctx.objects, ctx.resolved);
  const keepIfSpouse = (id: string | null): string | null =>
    id && accountSides(id).has("spouse") ? id : null;

  for (const obj of ctx.objects) {
    if (obj.entityOwnedById) continue; // follows its entity/container (Task 11)
    const alloc = ctx.resolved.get(allocationKey(obj.kind, obj.id));
    if (!alloc || alloc.disposition !== "spouse") continue;
    switch (obj.kind) {
      case "account":
        await moveAccount(tx, ctx, obj);
        break;
      case "income":
        await moveIncome(tx, ctx, obj, keepIfSpouse);
        break;
      case "expense":
        await moveExpense(tx, ctx, obj, keepIfSpouse);
        break;
      case "liability":
        await moveLiability(tx, ctx, obj, accountSides);
        break;
      case "note_receivable":
        await moveNote(tx, ctx, obj, entitySides);
        break;
      // entity / family_member moves + duplication → Task 11.
    }
  }

  await followGrantorEnums(tx, ctx);
  await handleLinks(tx, ctx, accountSides);
}

export async function commitDivorcePlan(args: {
  clientId: string;
  firmId: string;
  userId: string;
}): Promise<CommitResult> {
  const { clientId, firmId, userId } = args;

  // ── Preconditions (reads on the module db, before any write) ──
  const plan = await loadLiveDraft(clientId, firmId);
  if (!plan) throw new DivorceCommitError("no_draft", "No live divorce draft for this client");

  // Re-run the preview; any blocker aborts before we mint or snapshot anything.
  const preview = await buildCommitPreview({ clientId, firmId });
  if (preview.blockers.length > 0) {
    throw new DivorceCommitError(
      "blocked",
      "Commit is blocked by unresolved preconditions",
      preview.blockers,
    );
  }

  // Divisible objects + resolved allocations for the context the steps operate on.
  const { objects, baseScenarioId, primaryFamilyMemberId, spouseFamilyMemberId } =
    await loadDivisibleObjects(clientId);
  const allocationRows = await db
    .select({
      targetKind: divorcePlanAllocations.targetKind,
      targetId: divorcePlanAllocations.targetId,
      disposition: divorcePlanAllocations.disposition,
      splitPercentToSpouse: divorcePlanAllocations.splitPercentToSpouse,
    })
    .from(divorcePlanAllocations)
    .where(eq(divorcePlanAllocations.divorcePlanId, plan.id));
  const resolved = resolveAllocations(objects, allocationRows);

  // Original client's planning fields + household + the spouse CRM contact. The
  // preview guaranteed the spouse contact is complete (else spouse_contact_incomplete).
  const [pClient] = await db
    .select({
      advisorId: clients.advisorId,
      crmHouseholdId: clients.crmHouseholdId,
      retirementAge: clients.retirementAge,
      retirementMonth: clients.retirementMonth,
      lifeExpectancy: clients.lifeExpectancy,
      spouseRetirementAge: clients.spouseRetirementAge,
      spouseRetirementMonth: clients.spouseRetirementMonth,
      spouseLifeExpectancy: clients.spouseLifeExpectancy,
    })
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  if (!pClient) throw new DivorceCommitError("no_draft", "Client not found");

  const [spouseContact] = await db
    .select({
      firstName: crmHouseholdContacts.firstName,
      lastName: crmHouseholdContacts.lastName,
      dateOfBirth: crmHouseholdContacts.dateOfBirth,
    })
    .from(crmHouseholdContacts)
    .where(
      and(
        eq(crmHouseholdContacts.householdId, pClient.crmHouseholdId),
        eq(crmHouseholdContacts.role, "spouse"),
      ),
    )
    .limit(1);
  // Unreachable given the preview's spouse_contact_incomplete blocker; defensive.
  if (!spouseContact?.dateOfBirth) {
    throw new DivorceCommitError("blocked", "Spouse contact is incomplete");
  }
  // Bind the narrowed DOB to a const — the async transaction closure below
  // captures spouseContact, which re-widens its properties back to string|null.
  const spouseDob: string = spouseContact.dateOfBirth;
  const spouseFirstName = spouseContact.firstName;
  const spouseLastName = spouseContact.lastName;

  // ── Step 2: snapshot the pre-divorce baseline (before the tx; module db) ──
  const snapshot = await createSnapshot({
    clientId,
    firmId,
    leftRef: { kind: "scenario", id: "base", toggleState: {} },
    rightRef: { kind: "scenario", id: "base", toggleState: {} },
    name: "Pre-divorce baseline",
    description: `Baseline captured before the ${plan.splitYear} divorce split.`,
    sourceKind: "manual",
    userId,
  });

  // On the new file the ex-spouse is the household's PRIMARY contact/person.
  const spousePrimaryContact = {
    role: "primary" as const,
    firstName: spouseFirstName,
    lastName: spouseLastName,
    dateOfBirth: spouseDob,
  };

  let spouseHousehold: Awaited<ReturnType<typeof createCrmHousehold>> | undefined;
  try {
    // ── Step 3a: mint the spouse CRM household (before the tx; module db + auth) ──
    spouseHousehold = await createCrmHousehold({
      name:
        deriveHouseholdNameFromContacts([spousePrimaryContact]) ??
        `${spouseLastName} Household`,
      status: "active",
      advisorId: pClient.advisorId,
      // Only carry a real USPS code onto the new household; DB free-text is dropped.
      state: isUSPSStateCode(plan.spouseState) ? plan.spouseState : undefined,
      contacts: [spousePrimaryContact],
    });
    const spouseHouseholdId = spouseHousehold.id;

    const result = await db.transaction(async (tx): Promise<CommitResult> => {
      // ── Step 1: concurrency guard — the FIRST write. Flip the draft to
      // committed, gated on it still being a draft; 0 rows means another commit
      // won the race (or already finished). This lives inside the tx so an abort
      // rolls the status back to draft; a successful commit finalizes it. ──
      const guarded = await tx
        .update(divorcePlans)
        .set({ status: "committed", updatedAt: new Date() })
        .where(and(eq(divorcePlans.id, plan.id), eq(divorcePlans.status, "draft")))
        .returning({ id: divorcePlans.id });
      if (guarded.length === 0) {
        throw new DivorceCommitError("concurrent", "This divorce plan was already committed");
      }

      // ── Step 3b: mint the spouse planning client on our tx. It seeds S's
      // default cash account, $0 living expenses, and $0 SS incomes plus a
      // role='client' family_member — intentional fresh-start defaults. ──
      const created = await createClientForHousehold({
        household: {
          id: spouseHouseholdId,
          firmId,
          advisorId: pClient.advisorId,
          state: plan.spouseState ?? null,
        },
        primaryContact: {
          firstName: spouseFirstName,
          lastName: spouseLastName,
          dateOfBirth: spouseDob,
        },
        spouseContact: null,
        retirementAge: pClient.spouseRetirementAge ?? pClient.retirementAge,
        retirementMonth: pClient.spouseRetirementMonth ?? 1,
        lifeExpectancy: pClient.spouseLifeExpectancy ?? pClient.lifeExpectancy,
        filingStatus: plan.spouseFilingStatus,
        tx,
      });

      const ctx: CommitCtx = {
        plan,
        objects,
        resolved,
        primaryFamilyMemberId,
        spouseFamilyMemberId,
        baseScenarioId,
        spouseClientId: created.clientId,
        spouseScenarioId: created.scenarioId,
        spouseHouseholdId,
        spouseClientFamilyMemberId: "",
        fmRemap: new Map(),
        extBenRemap: new Map(),
        entityRemap: new Map(),
        warnings: [],
      };

      // ── Step 4: family-member remap ──
      await mintSpouseFamilyMembers(tx, ctx);

      // ── Step 5: move mechanics + follow rules (T10). Entity moves +
      // duplication (T11), then P-side cleanup + CRM ex_spouse edge +
      // audit/activity (T12) slot in around this call, all on `tx` against `ctx`. ──
      await moveAllocatedObjects(tx, ctx);

      // ── Finalize: record which client this draft produced. ──
      await tx
        .update(divorcePlans)
        .set({ resultClientId: created.clientId, committedAt: new Date(), updatedAt: new Date() })
        .where(eq(divorcePlans.id, plan.id));

      return {
        spouseClientId: created.clientId,
        spouseHouseholdId,
        spouseScenarioId: created.scenarioId,
        snapshotId: snapshot.id,
        warnings: ctx.warnings,
      };
    });

    return result;
  } catch (err) {
    // Compensating cleanup for the pre-tx side effects. A rolled-back tx never
    // created the spouse client, so the household drops cleanly (RESTRICT
    // satisfied); its CRM contacts + activity cascade with it.
    if (spouseHousehold) {
      await db.delete(crmHouseholds).where(eq(crmHouseholds.id, spouseHousehold.id)).catch(() => {});
    }
    await db.delete(scenarioSnapshots).where(eq(scenarioSnapshots.id, snapshot.id)).catch(() => {});
    throw err;
  }
}

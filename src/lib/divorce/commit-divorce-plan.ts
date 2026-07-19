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
  clientDeductions,
  crmHouseholds,
  crmHouseholdContacts,
  crmHouseholdRelationships,
  familyMembers,
  scenarioSnapshots,
  scenarioComputeCache,
  solverMcCache,
  accounts,
  accountOwners,
  accountHoldings,
  lifeInsurancePolicies,
  stockOptionAccounts,
  savingsRules,
  withdrawalStrategies,
  accountFlowOverrides,
  beneficiaryDesignations,
  externalBeneficiaries,
  revocableTrusts,
  entities,
  entityOwners,
  entityFlowOverrides,
  trustSplitInterestDetails,
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
import { recordAudit } from "@/lib/audit";
import { recordActivityNonFatal } from "@/lib/crm/activity";
import {
  allocationKey,
  resolveAllocations,
  type ResolvedAllocation,
  type DivisibleObject,
} from "./allocation-rules";
import { loadDivisibleObjects } from "./divisible-objects";
import { loadLiveDraft } from "./divorce-plans";
import { splitAmounts, type SplitShare } from "./split-math";
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
  code: "blocked" | "no_draft" | "concurrent" | "unresolvable_measuring_life";
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
  // Commit args threaded for the P-side cleanup writes (CRM ex_spouse edge +
  // audit/activity actor). `ctx.plan.firmId` also carries the firm, but the
  // audit/activity + relationship writes read these explicitly.
  firmId: string;
  userId: string;
  // The original (P) household — the ex_spouse edge points AT it and its spouse
  // CRM contact is struck during cleanup.
  primaryHouseholdId: string;
  // Cleanup-checklist selections resolved by the precondition preview (default
  // remove:true, persisted remove:false honored). Step 4 executes remove:true.
  cleanupSelections: CommitPreview["cleanup"];
  // P's default-checking account id captured BEFORE the moves — lets cleanup tell
  // "P lost its default (it moved to S)" from "P never had one" so it only
  // re-defaults in the former case (owed item a). "" when P had none.
  priorDefaultCheckingId: string;
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

// ── Step 5: move mechanics + follow rules (Commit engine B + C) ──────────────
//
// Re-homes every object the advisor allocated `spouse` onto S's file, applies
// the automatic grantor/owner-enum follows (gifts, medicare, wills), and drops
// the links that would straddle the two households (engine B). Splits divide a
// splittable account across the two files and duplication deep-copies an entity
// graph onto S (engine C, further below). All writes go on `tx`; nothing here
// touches the module `db`.

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
 * Re-normalize a bag of weighted survivor owners so their fractions sum to 100%
 * (decimal(6,4) — 100% is "1.0000", never "100.0000"). When nothing survives the
 * `fallback` becomes the sole 100% owner, so an object is never left ownerless.
 * The single normalization algorithm shared by the S-side move collapse
 * (`movedOwnerRows`) and the P-side joint-owner collapse (owed item b).
 */
function normalizeOwnerFractions(
  survivors: Array<Omit<OwnerValue, "percent"> & { weight: number }>,
  fallback: OwnerValue,
): OwnerValue[] {
  if (survivors.length === 0) return [fallback];
  const total = survivors.reduce((sum, x) => sum + x.weight, 0) || 1;
  return survivors.map((x) => ({
    familyMemberId: x.familyMemberId,
    entityId: x.entityId,
    externalBeneficiaryId: x.externalBeneficiaryId,
    percent: (x.weight / total).toFixed(4),
  }));
}

/**
 * Owner rows for a moved object, re-pointed to S. Owners whose person/entity
 * reaches S are remapped and kept, re-normalized so the survivors sum to 100%;
 * owners staying on P are dropped. When nothing survives (e.g. a solely-primary
 * account awarded to the ex-spouse) the mover — S's client — becomes the sole
 * 100% owner.
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
  return normalizeOwnerFractions(survivors, {
    familyMemberId: ctx.spouseClientFamilyMemberId,
    percent: "1.0000",
  });
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

/** Re-point ONE moved beneficiary designation onto S, remapping its named
 *  beneficiary (spouse→client, fm remap, external via ensureExternalBeneficiary,
 *  entity ref via entityRemap); drop + warn when it named someone who can't reach
 *  S. Shared by the moved-account and moved-entity (trust) designation paths so
 *  the two can never diverge. `label` names the container for the warning. */
async function moveDesignationRow(
  tx: Tx,
  ctx: CommitCtx,
  d: typeof beneficiaryDesignations.$inferSelect,
  label: string,
): Promise<void> {
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
      `Beneficiary designation on "${label}" dropped — it named someone who stays with the other household.`,
    );
    return;
  }
  await tx
    .update(beneficiaryDesignations)
    .set({
      clientId: ctx.spouseClientId,
      familyMemberId,
      householdRole,
      externalBeneficiaryId,
      // entity_id_ref names another entity; entityRemap re-points it to its S copy.
      entityIdRef: d.entityIdRef ? ctx.entityRemap.get(d.entityIdRef) ?? d.entityIdRef : null,
    })
    .where(eq(beneficiaryDesignations.id, d.id));
}

/** Re-point + remap a moved account's beneficiary designations. */
async function moveAccountDesignations(
  tx: Tx,
  ctx: CommitCtx,
  obj: DivisibleObject,
): Promise<void> {
  const rows = await tx
    .select()
    .from(beneficiaryDesignations)
    .where(eq(beneficiaryDesignations.accountId, obj.id));
  for (const d of rows) await moveDesignationRow(tx, ctx, d, obj.label);
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

// ── Step 5b: split + entity duplication (Commit engine C) ────────────────────
//
// Splits divide a splittable account into a primary share (kept in place on P)
// and a new spouse share (a fresh row on S); duplication deep-copies an entity's
// whole graph onto S while leaving P's copy untouched. Both slot in alongside the
// move mechanics (Task 10) inside `moveAllocatedObjects`; all writes go on `tx`.

/**
 * An account INSERT payload copied from `p` onto a new (client, scenario) with
 * the given value/basis/rothValue. Every business column rides along; the
 * overridden fields are the ones that must NOT duplicate onto a second file:
 * the id (fresh), prior-year-end value (recompute), the default-checking flag
 * (S keeps its own seeded one), and every cross-file reference — revocable-trust
 * tag, self-referential account FKs (parent / 529-rollover), and Plaid/Orion
 * linkage (or the S copy would masquerade as the same synced/linked account).
 * Firm-scoped model/ticker portfolio ids are safe to carry (shared across a
 * firm's clients). `deriveFromHoldings` is forced false: the copy carries no
 * account_holdings rows, so the projection loader (resolve-entity) MUST honor the
 * stored value/basis rather than a (missing/stale) holdings rollup.
 */
function accountCopyValues(
  p: typeof accounts.$inferSelect,
  over: { clientId: string; scenarioId: string; value: string; basis: string; rothValue: string },
): typeof accounts.$inferInsert {
  return {
    ...p,
    id: undefined, // fresh id
    createdAt: undefined,
    updatedAt: undefined,
    clientId: over.clientId,
    scenarioId: over.scenarioId,
    value: over.value,
    basis: over.basis,
    rothValue: over.rothValue,
    priorYearEndValue: null,
    isDefaultChecking: false,
    deriveFromHoldings: false,
    revocableTrustId: null,
    parentAccountId: null,
    rothRolloverAccountId: null,
    plaidItemId: null,
    plaidAccountId: null,
    externalProvider: null,
    externalId: null,
    lastSyncedAt: null,
  };
}

/**
 * Split every `split`-allocated account: shrink P's original row to its share
 * (owned 100% by the primary) and insert a NEW spouse-share row on S (owned 100%
 * by S's client). Savings / withdrawal / designation rows do NOT copy to the S
 * share — the advisor rebuilds them (the preview says so). The P row keeps its
 * own ride-alongs, just against a smaller balance.
 */
async function splitAccounts(tx: Tx, ctx: CommitCtx): Promise<void> {
  for (const obj of ctx.objects) {
    if (obj.entityOwnedById || obj.kind !== "account") continue;
    const alloc = ctx.resolved.get(allocationKey("account", obj.id));
    if (!alloc || alloc.disposition !== "split" || alloc.splitPercentToSpouse == null) continue;

    const [acct] = await tx.select().from(accounts).where(eq(accounts.id, obj.id)).limit(1);
    if (!acct) continue;
    const shares = splitAmounts(
      Number(acct.value),
      Number(acct.basis),
      Number(acct.rothValue),
      alloc.splitPercentToSpouse,
    );
    // splitAmounts returns numbers (shared with the UI/preview); accounts store
    // value/basis/rothValue as decimal strings, so format each share to cents.
    const toDecimalStrings = (s: SplitShare) => ({
      value: s.value.toFixed(2),
      basis: s.basis.toFixed(2),
      rothValue: s.rothValue.toFixed(2),
    });
    const primaryShare = toDecimalStrings(shares.primary);
    const spouseShare = toDecimalStrings(shares.spouse);

    // If the account was holdings-driven, the stored dollar split is now
    // authoritative (holdings can't be split), so BOTH shares stop deriving from
    // holdings — else the projection loader would re-inflate P to the full
    // pre-split value AND add the S share (~160% of the household). Holdings stay
    // attached to P but no longer drive value; warn so the advisor rebuilds them.
    const [hasHolding] = await tx
      .select({ id: accountHoldings.id })
      .from(accountHoldings)
      .where(eq(accountHoldings.accountId, obj.id))
      .limit(1);
    if (hasHolding) {
      ctx.warnings.push(
        `"${acct.name}" was split by stored value — its holdings stay on the original household but no longer drive either share's balance. Review/rebuild the holdings on both shares.`,
      );
    }

    // P keeps the original row (and its links), reduced to the primary share.
    await tx
      .update(accounts)
      .set({ ...primaryShare, deriveFromHoldings: false, updatedAt: new Date() })
      .where(eq(accounts.id, obj.id));
    await tx.delete(accountOwners).where(eq(accountOwners.accountId, obj.id));
    await tx.insert(accountOwners).values({
      accountId: obj.id,
      familyMemberId: ctx.primaryFamilyMemberId,
      percent: "1.0000",
    });

    // S gets a fresh row for the spouse share, owned 100% by S's client.
    const [sAcct] = await tx
      .insert(accounts)
      .values(
        accountCopyValues(acct, {
          clientId: ctx.spouseClientId,
          scenarioId: ctx.spouseScenarioId,
          ...spouseShare,
        }),
      )
      .returning({ id: accounts.id });
    await tx.insert(accountOwners).values({
      accountId: sAcct.id,
      familyMemberId: ctx.spouseClientFamilyMemberId,
      percent: "1.0000",
    });
  }
}

/** entity_owners of a duplicated entity, re-homed on the S copy. fm owners
 *  remap through fmRemap (unmappable → drop: the owner stays with P); owners
 *  that are themselves an entity copy over only when that entity also reached S
 *  (moved or duplicated), else drop + warn. Percents copy verbatim — no
 *  re-normalization (entity_owners carries no sum-to-100 constraint). */
async function duplicateEntityOwners(
  tx: Tx,
  ctx: CommitCtx,
  obj: DivisibleObject,
  sEntityId: string,
): Promise<void> {
  const rows = await tx.select().from(entityOwners).where(eq(entityOwners.entityId, obj.id));
  for (const r of rows) {
    if (r.familyMemberId) {
      const mapped = ctx.fmRemap.get(r.familyMemberId);
      if (!mapped) continue; // owner stays with the other household
      await tx.insert(entityOwners).values({
        entityId: sEntityId,
        familyMemberId: mapped,
        percent: r.percent,
      });
    } else if (r.ownerEntityId) {
      const mapped = ctx.entityRemap.get(r.ownerEntityId);
      if (!mapped) {
        ctx.warnings.push(
          `An owner of "${obj.label}" was dropped — the owning entity stays with the other household.`,
        );
        continue;
      }
      await tx.insert(entityOwners).values({
        entityId: sEntityId,
        ownerEntityId: mapped,
        percent: r.percent,
      });
    }
  }
}

// Term types whose CHECK constraints require a measuring life (schema.ts
// split_interest_measuring_life_required / _joint_life_requires_two). For these,
// a measuring life that can't be carried onto S can't just be nulled — it would
// violate the CHECK and abort the whole commit with an opaque DB error. So we
// throw an actionable DivorceCommitError instead (same atomic rollback, clear cause).
const MEASURING_LIFE1_TERM_TYPES = new Set(["single_life", "joint_life", "shorter_of_years_or_life"]);

/** Remap one measuring-life family-member FK onto S. Remap when possible; null
 *  only where the term type legally allows it; otherwise throw. */
function remapMeasuringLife(
  ctx: CommitCtx,
  id: string | null,
  required: boolean,
  label: string,
): string | null {
  if (id) {
    const mapped = ctx.fmRemap.get(id);
    if (mapped) return mapped;
  }
  if (required) {
    throw new DivorceCommitError(
      "unresolvable_measuring_life",
      `The charitable trust "${label}" measures its term on a person who stays with the other household, so it can't be carried onto the new file. Reassign that measuring life (or the trust) before committing this divorce plan.`,
    );
  }
  return null;
}

/** The S-side charity + measuring-life FKs for a split-interest trust, shared by
 *  the duplicate (insert) and whole-to-spouse move (update) paths so the remap
 *  semantics — including the measuring-life throw rule — can never diverge. */
async function resolveSplitInterestRefs(
  tx: Tx,
  ctx: CommitCtx,
  d: typeof trustSplitInterestDetails.$inferSelect,
  label: string,
): Promise<{ charityId: string; measuringLife1Id: string | null; measuringLife2Id: string | null }> {
  return {
    charityId: await ensureExternalBeneficiary(tx, ctx, d.charityId),
    measuringLife1Id: remapMeasuringLife(
      ctx,
      d.measuringLife1Id,
      MEASURING_LIFE1_TERM_TYPES.has(d.termType),
      label,
    ),
    measuringLife2Id: remapMeasuringLife(ctx, d.measuringLife2Id, d.termType === "joint_life", label),
  };
}

/** trust_split_interest_details (CRT/CLT) copied onto the S entity. */
async function duplicateSplitInterest(
  tx: Tx,
  ctx: CommitCtx,
  obj: DivisibleObject,
  sEntityId: string,
): Promise<void> {
  const [d] = await tx
    .select()
    .from(trustSplitInterestDetails)
    .where(eq(trustSplitInterestDetails.entityId, obj.id))
    .limit(1);
  if (!d) return;
  const refs = await resolveSplitInterestRefs(tx, ctx, d, obj.label);
  await tx.insert(trustSplitInterestDetails).values({
    ...d,
    createdAt: undefined,
    updatedAt: undefined,
    entityId: sEntityId,
    clientId: ctx.spouseClientId,
    ...refs,
  });
}

/** The base-plan (null-scenario) + base-scenario sparse cells of a flow-override
 *  set, re-scoped for the S owner (null stays null; base(P) → base(S)). Non-base
 *  scenario rows are skipped — those scenarios don't exist on S (and a commit is
 *  blocked while any survive). Shared by the entity + owned-account copies. */
type FlowOverrideCell = {
  scenarioId: string | null;
  year: number;
  incomeAmount: string | null;
  expenseAmount: string | null;
  distributionPercent: string | null;
};
function baseFlowOverrideCells(ctx: CommitCtx, rows: FlowOverrideCell[]): FlowOverrideCell[] {
  return rows
    .filter((r) => r.scenarioId === null || r.scenarioId === ctx.baseScenarioId)
    .map((r) => ({
      scenarioId: r.scenarioId === null ? null : ctx.spouseScenarioId,
      year: r.year,
      incomeAmount: r.incomeAmount,
      expenseAmount: r.expenseAmount,
      distributionPercent: r.distributionPercent,
    }));
}

/** True when the account carries a 1:1 life-insurance or stock-option extension
 *  row. Those keys off accounts.id, so a fresh-id copy does NOT inherit them. */
async function hasPolicyRideAlong(tx: Tx, accountId: string): Promise<boolean> {
  const [li] = await tx
    .select({ id: lifeInsurancePolicies.accountId })
    .from(lifeInsurancePolicies)
    .where(eq(lifeInsurancePolicies.accountId, accountId))
    .limit(1);
  if (li) return true;
  const [so] = await tx
    .select({ id: stockOptionAccounts.accountId })
    .from(stockOptionAccounts)
    .where(eq(stockOptionAccounts.accountId, accountId))
    .limit(1);
  return !!so;
}

/** The entity's owned accounts, copied to S: a fresh account row (values equal
 *  to P's) owned 100% by the S entity, plus each account's base flow overrides.
 *  A copied account gets a NEW id, so its 1:1 life-insurance / stock-option
 *  extension rows do NOT ride along (unlike the move path, which keeps the id).
 *  Those carry product-specific structure (insured-person, grants, vesting) whose
 *  re-attribution is a product decision, so we warn rather than invent semantics. */
async function duplicateEntityAccounts(
  tx: Tx,
  ctx: CommitCtx,
  obj: DivisibleObject,
  sEntityId: string,
): Promise<void> {
  for (const childId of obj.childIds) {
    const [child] = await tx.select().from(accounts).where(eq(accounts.id, childId)).limit(1);
    if (!child) continue;
    const [sChild] = await tx
      .insert(accounts)
      .values(
        accountCopyValues(child, {
          clientId: ctx.spouseClientId,
          scenarioId: ctx.spouseScenarioId,
          value: child.value,
          basis: child.basis,
          rothValue: child.rothValue,
        }),
      )
      .returning({ id: accounts.id });
    await tx.insert(accountOwners).values({
      accountId: sChild.id,
      entityId: sEntityId,
      percent: "1.0000",
    });
    if (await hasPolicyRideAlong(tx, childId)) {
      ctx.warnings.push(
        `"${child.name}" in "${obj.label}" has a life-insurance or stock-option policy that was NOT copied to the new household — rebuild it there if the duplicated trust should carry it.`,
      );
    }
    const foRows = await tx
      .select()
      .from(accountFlowOverrides)
      .where(eq(accountFlowOverrides.accountId, childId));
    const foCells = baseFlowOverrideCells(ctx, foRows);
    if (foCells.length) {
      await tx
        .insert(accountFlowOverrides)
        .values(foCells.map((v) => ({ accountId: sChild.id, ...v })));
    }
  }
}

/** incomes/expenses owned by the entity, copied to S. Cross-file cash / policy /
 *  linked-account references are nulled (the engine falls back to entity default
 *  checking); an expense's "for" family member remaps or nulls. */
async function duplicateEntityIncomesExpenses(
  tx: Tx,
  ctx: CommitCtx,
  pEntityId: string,
  sEntityId: string,
): Promise<void> {
  const incRows = await tx.select().from(incomes).where(eq(incomes.ownerEntityId, pEntityId));
  for (const r of incRows) {
    await tx.insert(incomes).values({
      ...r,
      id: undefined,
      createdAt: undefined,
      updatedAt: undefined,
      clientId: ctx.spouseClientId,
      scenarioId: ctx.spouseScenarioId,
      ownerEntityId: sEntityId,
      cashAccountId: null,
      ownerAccountId: null,
      linkedPropertyId: null,
    });
  }
  const exRows = await tx.select().from(expenses).where(eq(expenses.ownerEntityId, pEntityId));
  for (const r of exRows) {
    await tx.insert(expenses).values({
      ...r,
      id: undefined,
      createdAt: undefined,
      updatedAt: undefined,
      clientId: ctx.spouseClientId,
      scenarioId: ctx.spouseScenarioId,
      ownerEntityId: sEntityId,
      cashAccountId: null,
      sourcePolicyAccountId: null,
      ownerAccountId: null,
      forFamilyMemberId: r.forFamilyMemberId ? ctx.fmRemap.get(r.forFamilyMemberId) ?? null : null,
    });
  }
}

/** trust-target beneficiary designations (targetKind='trust') on the entity,
 *  copied to the S entity: named beneficiary resolved onto S (spouse→client, fm
 *  remap, external via ensureExternalBeneficiary) — dropped when it can't be
 *  carried; a named-entity ref remaps or nulls. */
async function duplicateTrustDesignations(
  tx: Tx,
  ctx: CommitCtx,
  pEntityId: string,
  sEntityId: string,
): Promise<void> {
  const rows = await tx
    .select()
    .from(beneficiaryDesignations)
    .where(
      and(
        eq(beneficiaryDesignations.targetKind, "trust"),
        eq(beneficiaryDesignations.entityId, pEntityId),
      ),
    );
  for (const d of rows) {
    let familyMemberId = d.familyMemberId;
    let householdRole = d.householdRole;
    let externalBeneficiaryId = d.externalBeneficiaryId;
    if (householdRole) {
      if (householdRole === "spouse") householdRole = "client";
      else continue; // names the primary — can't reach S
    } else if (familyMemberId) {
      const mapped = ctx.fmRemap.get(familyMemberId);
      if (!mapped) continue;
      familyMemberId = mapped;
    } else if (externalBeneficiaryId) {
      externalBeneficiaryId = await ensureExternalBeneficiary(tx, ctx, externalBeneficiaryId);
    }
    await tx.insert(beneficiaryDesignations).values({
      ...d,
      id: undefined,
      createdAt: undefined,
      updatedAt: undefined,
      clientId: ctx.spouseClientId,
      entityId: sEntityId,
      familyMemberId,
      householdRole,
      externalBeneficiaryId,
      entityIdRef: d.entityIdRef ? ctx.entityRemap.get(d.entityIdRef) ?? null : null,
    });
  }
}

/**
 * Deep-copy every `duplicate`-allocated entity onto S. P's copy is untouched (it
 * IS the primary's). Two phases: first mint the S entity rows so `entityRemap`
 * carries every duplicated id before any owner/reference is written (entities
 * can own entities); then copy each entity's dependent graph. The S copy's
 * grantor flips per the Rulebook — that side's grantor person (`spouse`) becomes
 * `client`, everyone else nulls — and `isGrantor` survives only when the S copy
 * still has a grantor.
 */
async function duplicateEntities(tx: Tx, ctx: CommitCtx): Promise<void> {
  const dupObjs = ctx.objects.filter(
    (o) =>
      o.kind === "entity" &&
      ctx.resolved.get(allocationKey("entity", o.id))?.disposition === "duplicate",
  );
  if (dupObjs.length === 0) return;

  // Phase 1 — mint the S entity rows + record old→new (before any owner writes).
  for (const obj of dupObjs) {
    const [p] = await tx.select().from(entities).where(eq(entities.id, obj.id)).limit(1);
    if (!p) continue;
    const sGrantor = p.grantor === "spouse" ? "client" : null;
    const [s] = await tx
      .insert(entities)
      .values({
        ...p,
        id: undefined, // fresh id
        createdAt: undefined,
        updatedAt: undefined,
        clientId: ctx.spouseClientId,
        grantor: sGrantor,
        isGrantor: p.isGrantor && sGrantor !== null,
      })
      .returning({ id: entities.id });
    ctx.entityRemap.set(obj.id, s.id);
  }

  // Phase 2 — copy each entity's dependent graph onto its S id.
  for (const obj of dupObjs) {
    const sEntityId = ctx.entityRemap.get(obj.id);
    if (!sEntityId) continue;
    await duplicateEntityOwners(tx, ctx, obj, sEntityId);
    await duplicateSplitInterest(tx, ctx, obj, sEntityId);
    const efoRows = await tx
      .select()
      .from(entityFlowOverrides)
      .where(eq(entityFlowOverrides.entityId, obj.id));
    const efoCells = baseFlowOverrideCells(ctx, efoRows);
    if (efoCells.length) {
      await tx
        .insert(entityFlowOverrides)
        .values(efoCells.map((v) => ({ entityId: sEntityId, ...v })));
    }
    await duplicateEntityAccounts(tx, ctx, obj, sEntityId);
    await duplicateEntityIncomesExpenses(tx, ctx, obj.id, sEntityId);
    await duplicateTrustDesignations(tx, ctx, obj.id, sEntityId);
  }
}

/** Re-point a moved trust's split-interest details onto S (clientId → S client),
 *  remapping charity + measuring-life FKs with the SAME semantics as the
 *  duplicate path (including the measuring-life throw rule). The entity id is
 *  unchanged, so the row stays keyed on it. */
async function moveSplitInterest(
  tx: Tx,
  ctx: CommitCtx,
  obj: DivisibleObject,
): Promise<void> {
  const [d] = await tx
    .select()
    .from(trustSplitInterestDetails)
    .where(eq(trustSplitInterestDetails.entityId, obj.id))
    .limit(1);
  if (!d) return;
  const refs = await resolveSplitInterestRefs(tx, ctx, d, obj.label);
  await tx
    .update(trustSplitInterestDetails)
    .set({ clientId: ctx.spouseClientId, ...refs, updatedAt: new Date() })
    .where(eq(trustSplitInterestDetails.entityId, obj.id));
}

/** Re-point a moved trust's own (targetKind='trust') beneficiary designations
 *  onto S, reusing the shared per-row mover (drop+warn on unresolvable). The
 *  entity id is unchanged, so each row stays attached to the same trust. */
async function moveTrustDesignations(
  tx: Tx,
  ctx: CommitCtx,
  obj: DivisibleObject,
): Promise<void> {
  const rows = await tx
    .select()
    .from(beneficiaryDesignations)
    .where(
      and(
        eq(beneficiaryDesignations.targetKind, "trust"),
        eq(beneficiaryDesignations.entityId, obj.id),
      ),
    );
  for (const d of rows) await moveDesignationRow(tx, ctx, d, obj.label);
}

/**
 * Move an entity whole to S (Rulebook entity `spouse` row): re-point the entity
 * in place (grantor flip per the Rulebook), collapse its owners to the mover,
 * and follow its owned accounts (+ scenario-scoped ride-alongs), ownerEntityId
 * incomes/expenses, flow overrides, split-interest details, and its own
 * trust-target designations onto S's base. The entity id is unchanged, so its
 * accounts' entity-ownership rows ride along without a remap.
 */
async function moveEntityWhole(tx: Tx, ctx: CommitCtx, obj: DivisibleObject): Promise<void> {
  const [ent] = await tx.select().from(entities).where(eq(entities.id, obj.id)).limit(1);
  if (!ent) return;
  const sGrantor = ent.grantor === "spouse" ? "client" : null;
  await tx
    .update(entities)
    .set({
      clientId: ctx.spouseClientId,
      grantor: sGrantor,
      isGrantor: ent.isGrantor && sGrantor !== null,
      updatedAt: new Date(),
    })
    .where(eq(entities.id, obj.id));

  // entity_owners collapse to the mover (mirrors moved accounts/liabilities).
  const ownerRows = await tx.select().from(entityOwners).where(eq(entityOwners.entityId, obj.id));
  const survivors = await movedOwnerRows(
    tx,
    ctx,
    ownerRows.map((r) => ({
      familyMemberId: r.familyMemberId,
      entityId: r.ownerEntityId,
      percent: r.percent,
    })),
  );
  await tx.delete(entityOwners).where(eq(entityOwners.entityId, obj.id));
  for (const s of survivors) {
    // entity_owners is family-member OR entity only (never external).
    if (s.familyMemberId) {
      await tx.insert(entityOwners).values({
        entityId: obj.id,
        familyMemberId: s.familyMemberId,
        percent: s.percent,
      });
    } else if (s.entityId) {
      await tx.insert(entityOwners).values({
        entityId: obj.id,
        ownerEntityId: s.entityId,
        percent: s.percent,
      });
    }
  }

  // Owned accounts + their (client, scenario, account)-scoped ride-alongs follow.
  for (const childId of obj.childIds) {
    await tx
      .update(accounts)
      .set({ clientId: ctx.spouseClientId, scenarioId: ctx.spouseScenarioId, updatedAt: new Date() })
      .where(eq(accounts.id, childId));
    await tx
      .update(accountFlowOverrides)
      .set({ scenarioId: ctx.spouseScenarioId })
      .where(
        and(
          eq(accountFlowOverrides.accountId, childId),
          eq(accountFlowOverrides.scenarioId, ctx.baseScenarioId),
        ),
      );
    await tx
      .update(savingsRules)
      .set({ clientId: ctx.spouseClientId, scenarioId: ctx.spouseScenarioId })
      .where(eq(savingsRules.accountId, childId));
    await tx
      .update(withdrawalStrategies)
      .set({ clientId: ctx.spouseClientId, scenarioId: ctx.spouseScenarioId })
      .where(eq(withdrawalStrategies.accountId, childId));
  }

  // ownerEntityId incomes/expenses follow (base scenario → base(S)). Their
  // cross-side cashAccountId/sourcePolicyAccountId are intentionally NOT nulled
  // here (unlike the household income/expense move arms): an entity's cash/policy
  // reference is normally one of its OWN accounts, which are moving alongside it
  // in the loop above, so the reference stays valid on S. A reference to an
  // account NOT owned by this entity is an unusual cross-container link left
  // as-is (the engine falls back to entity default checking if it dangles).
  await tx
    .update(incomes)
    .set({ clientId: ctx.spouseClientId, scenarioId: ctx.spouseScenarioId, updatedAt: new Date() })
    .where(eq(incomes.ownerEntityId, obj.id));
  await tx
    .update(expenses)
    .set({ clientId: ctx.spouseClientId, scenarioId: ctx.spouseScenarioId, updatedAt: new Date() })
    .where(eq(expenses.ownerEntityId, obj.id));

  // entity_flow_overrides base rows → base(S); null-scenario rows follow via FK.
  await tx
    .update(entityFlowOverrides)
    .set({ scenarioId: ctx.spouseScenarioId })
    .where(
      and(
        eq(entityFlowOverrides.entityId, obj.id),
        eq(entityFlowOverrides.scenarioId, ctx.baseScenarioId),
      ),
    );

  // Split-interest details + the trust's own beneficiary designations re-point to
  // S with the same charity/measuring-life/beneficiary remap as the duplicate
  // path — else a moved CRT would silently strand its remainder structure on P.
  await moveSplitInterest(tx, ctx, obj);
  await moveTrustDesignations(tx, ctx, obj);
}

/**
 * Move every `spouse`-allocated object onto S, deep-copy every `duplicate`
 * entity, split every `split` account, apply the automatic grantor/owner-enum
 * follows, then follow-or-drop the technique links. Duplicated + whole-to-spouse
 * entities are registered in `entityRemap` FIRST so owner rows, `entity_id_ref`
 * designations, and cross-entity references resolve regardless of order.
 */
async function moveAllocatedObjects(tx: Tx, ctx: CommitCtx): Promise<void> {
  const { accountSides, entitySides } = buildSideResolvers(ctx.objects, ctx.resolved);
  const keepIfSpouse = (id: string | null): string | null =>
    id && accountSides(id).has("spouse") ? id : null;

  // Whole-to-spouse entities keep their id — register it now (id→id) so a
  // duplicated entity owned by one, or a designation referencing one, resolves
  // before the entity move arm below re-points the row.
  for (const obj of ctx.objects) {
    if (
      obj.kind === "entity" &&
      ctx.resolved.get(allocationKey("entity", obj.id))?.disposition === "spouse"
    ) {
      ctx.entityRemap.set(obj.id, obj.id);
    }
  }
  // Deep-copy the duplicate-allocated entity graphs; fills entityRemap with the
  // new S ids that the account/designation moves and grantor follows below read.
  await duplicateEntities(tx, ctx);

  for (const obj of ctx.objects) {
    if (obj.entityOwnedById) continue; // follows its entity/container
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
      case "entity":
        await moveEntityWhole(tx, ctx, obj);
        break;
      // family_member copies are minted in Step 4 (mintSpouseFamilyMembers).
    }
  }

  await splitAccounts(tx, ctx);
  await followGrantorEnums(tx, ctx);
  await handleLinks(tx, ctx, accountSides);
}

// ── Step 6: original (P) cleanup + bookkeeping (Commit engine D) ──────────────
//
// After the moves/splits/duplication have re-homed everything bound for S, the P
// file still describes a married household — it carries the ex-spouse's planning
// fields, joint owner rows + enum flips, the spouse's family member + CRM
// contact, and stale caches. `cleanupOriginal` reconciles all of that and writes
// the CRM ex_spouse edge; `finalize` records the commit + invalidates caches.
// Every data write is on `tx`; the audit/activity records ride the module db
// (append-only — orphan rows on a rollback are the tolerated convention).

/** Drop the spouse-fm owner from ONE P-retained object's owner rows and
 *  re-normalize the survivors to 100% (fallback: the primary at 100%). */
function collapseOwnersDroppingSpouse(
  rows: Array<{
    familyMemberId: string | null;
    entityId?: string | null;
    externalBeneficiaryId?: string | null;
    percent: string;
  }>,
  spouseFmId: string,
  primaryFmId: string,
): OwnerValue[] {
  const survivors = rows
    .filter((r) => r.familyMemberId !== spouseFmId)
    .map((r) => ({
      familyMemberId: r.familyMemberId ?? undefined,
      entityId: r.entityId ?? undefined,
      externalBeneficiaryId: r.externalBeneficiaryId ?? undefined,
      weight: Number(r.percent),
    }));
  return normalizeOwnerFractions(survivors, { familyMemberId: primaryFmId, percent: "1.0000" });
}

/**
 * For every P-retained object still owned in part by the ex-spouse's family
 * member, drop that owner and re-normalize the rest to 100% — BEFORE the spouse
 * fm is deleted (owed item b). The fm FK on every owner table is ON DELETE
 * CASCADE, so deleting it would otherwise strand a joint account/liability at
 * <100% and trip the deferred owner-sum check, rolling the whole commit back.
 * Moves already stripped their spouse-fm rows, so a surviving reference is
 * exactly a P-retained joint object (incl. a duplicate entity's kept copy).
 */
async function collapseRetainedJointOwners(tx: Tx, ctx: CommitCtx): Promise<void> {
  const spouseFm = ctx.spouseFamilyMemberId;
  if (!spouseFm) return;
  const primaryFm = ctx.primaryFamilyMemberId;
  const distinct = <T>(xs: T[]): T[] => [...new Set(xs)];

  // account_owners (fm | entity | external)
  const acctHits = await tx
    .select({ id: accountOwners.accountId })
    .from(accountOwners)
    .where(eq(accountOwners.familyMemberId, spouseFm));
  for (const accountId of distinct(acctHits.map((h) => h.id))) {
    const rows = await tx.select().from(accountOwners).where(eq(accountOwners.accountId, accountId));
    const survivors = collapseOwnersDroppingSpouse(rows, spouseFm, primaryFm);
    await tx.delete(accountOwners).where(eq(accountOwners.accountId, accountId));
    await tx.insert(accountOwners).values(
      survivors.map((s) => ({
        accountId,
        familyMemberId: s.familyMemberId ?? null,
        entityId: s.entityId ?? null,
        externalBeneficiaryId: s.externalBeneficiaryId ?? null,
        percent: s.percent,
      })),
    );
  }

  // liability_owners (fm | entity)
  const libHits = await tx
    .select({ id: liabilityOwners.liabilityId })
    .from(liabilityOwners)
    .where(eq(liabilityOwners.familyMemberId, spouseFm));
  for (const liabilityId of distinct(libHits.map((h) => h.id))) {
    const rows = await tx.select().from(liabilityOwners).where(eq(liabilityOwners.liabilityId, liabilityId));
    const survivors = collapseOwnersDroppingSpouse(rows, spouseFm, primaryFm);
    await tx.delete(liabilityOwners).where(eq(liabilityOwners.liabilityId, liabilityId));
    await tx.insert(liabilityOwners).values(
      survivors.map((s) => ({
        liabilityId,
        familyMemberId: s.familyMemberId ?? null,
        entityId: s.entityId ?? null,
        percent: s.percent,
      })),
    );
  }

  // note_receivable_owners (fm | entity | external)
  const noteHits = await tx
    .select({ id: noteReceivableOwners.noteReceivableId })
    .from(noteReceivableOwners)
    .where(eq(noteReceivableOwners.familyMemberId, spouseFm));
  for (const noteReceivableId of distinct(noteHits.map((h) => h.id))) {
    const rows = await tx
      .select()
      .from(noteReceivableOwners)
      .where(eq(noteReceivableOwners.noteReceivableId, noteReceivableId));
    const survivors = collapseOwnersDroppingSpouse(rows, spouseFm, primaryFm);
    await tx.delete(noteReceivableOwners).where(eq(noteReceivableOwners.noteReceivableId, noteReceivableId));
    await tx.insert(noteReceivableOwners).values(
      survivors.map((s) => ({
        noteReceivableId,
        familyMemberId: s.familyMemberId ?? null,
        entityId: s.entityId ?? null,
        externalBeneficiaryId: s.externalBeneficiaryId ?? null,
        percent: s.percent,
      })),
    );
  }

  // entity_owners (fm | ownerEntity). No sum-to-100 constraint, but collapse
  // anyway so a duplicate-allocated entity's retained P copy doesn't silently
  // lose an owner when the spouse fm cascades.
  const entHits = await tx
    .select({ id: entityOwners.entityId })
    .from(entityOwners)
    .where(eq(entityOwners.familyMemberId, spouseFm));
  for (const entityId of distinct(entHits.map((h) => h.id))) {
    const rows = await tx.select().from(entityOwners).where(eq(entityOwners.entityId, entityId));
    const survivors = collapseOwnersDroppingSpouse(
      rows.map((r) => ({ familyMemberId: r.familyMemberId, entityId: r.ownerEntityId, percent: r.percent })),
      spouseFm,
      primaryFm,
    );
    await tx.delete(entityOwners).where(eq(entityOwners.entityId, entityId));
    await tx.insert(entityOwners).values(
      survivors.map((s) => ({
        entityId,
        familyMemberId: s.familyMemberId ?? null,
        ownerEntityId: s.entityId ?? null,
        percent: s.percent,
      })),
    );
  }
}

/**
 * A `duplicate`-allocated entity's P copy is left untouched by the duplication
 * pass (it IS the primary's). If its grantor was the spouse, the retained copy
 * still points at the departed person — flip it off (grantor → null) and
 * recompute isGrantor, mirroring on the primary's side what the S copy did on the
 * spouse's (owed item c).
 */
async function cleanupDuplicateGrantors(tx: Tx, ctx: CommitCtx): Promise<void> {
  for (const obj of ctx.objects) {
    if (obj.kind !== "entity") continue;
    if (ctx.resolved.get(allocationKey("entity", obj.id))?.disposition !== "duplicate") continue;
    await tx
      .update(entities)
      .set({ grantor: null, isGrantor: false, updatedAt: new Date() })
      .where(and(eq(entities.id, obj.id), eq(entities.grantor, "spouse")));
  }
}

/**
 * If P's default-checking account was awarded to the spouse, P is left with zero
 * default-checking rows — promote another household cash account (owed item a).
 * Mirrors the seeded default's shape: a `cash` account (prefer `checking`), never
 * entity-owned (entities carry their own default checking). Only fires when P
 * actually LOST its default — a P that never had one is left unchanged.
 */
async function redefaultChecking(tx: Tx, ctx: CommitCtx): Promise<void> {
  if (!ctx.priorDefaultCheckingId) return; // P never had a default
  const P = ctx.plan.clientId;
  const [stillDefault] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.clientId, P), eq(accounts.isDefaultChecking, true)))
    .limit(1);
  if (stillDefault) return; // the default stayed on P

  const cashRows = await tx
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.clientId, P),
        eq(accounts.scenarioId, ctx.baseScenarioId),
        eq(accounts.category, "cash"),
      ),
    );
  if (cashRows.length === 0) return;
  const ownerRows = await tx
    .select({ accountId: accountOwners.accountId, entityId: accountOwners.entityId })
    .from(accountOwners)
    .where(inArray(accountOwners.accountId, cashRows.map((a) => a.id)));
  const entityOwned = new Set(ownerRows.filter((o) => o.entityId).map((o) => o.accountId));
  const eligible = cashRows.filter((a) => !entityOwned.has(a.id));
  const candidate = eligible.find((a) => a.subType === "checking") ?? eligible[0];
  if (!candidate) return;
  await tx
    .update(accounts)
    .set({ isDefaultChecking: true, updatedAt: new Date() })
    .where(eq(accounts.id, candidate.id));
}

/** P-side cleanup: reconcile the original file to a single, unmarried household
 *  and write the CRM ex_spouse edge. Runs after all S-bound moves. */
async function cleanupOriginal(tx: Tx, ctx: CommitCtx): Promise<void> {
  const P = ctx.plan.clientId;

  // 1. clients P row: null the ex-spouse planning fields; adopt the primary's
  //    post-split filing status.
  await tx
    .update(clients)
    .set({
      spouseRetirementAge: null,
      spouseRetirementMonth: null,
      spouseLifeExpectancy: null,
      filingStatus: ctx.plan.primaryFilingStatus,
      updatedAt: new Date(),
    })
    .where(eq(clients.id, P));

  // 2. Owner-enum flips on P: a surviving 'joint' row becomes the client's
  //    (spouse-owned rows already moved to S). medicare_coverage is never 'joint'
  //    in live data (its dbMapper rejects it) — the flip is a defensive no-op.
  await tx
    .update(incomes)
    .set({ owner: "client", updatedAt: new Date() })
    .where(and(eq(incomes.clientId, P), eq(incomes.owner, "joint")));
  await tx
    .update(clientDeductions)
    .set({ owner: "client", updatedAt: new Date() })
    .where(and(eq(clientDeductions.clientId, P), eq(clientDeductions.owner, "joint")));
  await tx
    .update(medicareCoverage)
    .set({ owner: "client", updatedAt: new Date() })
    .where(and(eq(medicareCoverage.clientId, P), eq(medicareCoverage.owner, "joint")));

  // 3. P-side grantor cleanup for duplicate-allocated entities (owed item c).
  await cleanupDuplicateGrantors(tx, ctx);

  // 4. Collapse retained joint owners referencing the spouse fm BEFORE the delete
  //    (owed item b).
  await collapseRetainedJointOwners(tx, ctx);

  // 5. Delete the spouse's P family member + any child/other member awarded to
  //    the spouse (their S copies were minted in Step 4). The fm delete cascades
  //    the P designations naming them; strike the spouse's CRM contact explicitly
  //    (it may not carry the family_member live-join, so cascade can't be relied
  //    on).
  const spouseAllocatedFmIds = ctx.objects
    .filter((o) => o.kind === "family_member")
    .filter((o) => ctx.resolved.get(allocationKey("family_member", o.id))?.disposition === "spouse")
    .map((o) => o.id);
  const fmIdsToDelete = [ctx.spouseFamilyMemberId, ...spouseAllocatedFmIds].filter(
    (id): id is string => !!id,
  );
  if (fmIdsToDelete.length) {
    await tx.delete(familyMembers).where(inArray(familyMembers.id, fmIdsToDelete));
  }
  await tx
    .delete(crmHouseholdContacts)
    .where(
      and(
        eq(crmHouseholdContacts.householdId, ctx.primaryHouseholdId),
        eq(crmHouseholdContacts.role, "spouse"),
      ),
    );

  // 6. Execute the cleanup checklist: strike every remove:true selection. Re-scan
  //    by id — a designation already cascaded by the fm delete is a silent no-op.
  for (const sel of ctx.cleanupSelections) {
    if (!sel.remove) continue;
    if (sel.source === "beneficiary_designation") {
      await tx.delete(beneficiaryDesignations).where(eq(beneficiaryDesignations.id, sel.id));
    } else if (sel.source === "will_bequest_recipient") {
      await tx.delete(willBequestRecipients).where(eq(willBequestRecipients.id, sel.id));
    } else {
      await tx.delete(willResiduaryRecipients).where(eq(willResiduaryRecipients.id, sel.id));
    }
  }

  // 7. Re-default P's household checking if the old default was awarded to S
  //    (owed item a).
  await redefaultChecking(tx, ctx);

  // 8. CRM ex_spouse edge: from the spouse's new household TO the original.
  await tx.insert(crmHouseholdRelationships).values({
    firmId: ctx.firmId,
    fromHouseholdId: ctx.spouseHouseholdId,
    toHouseholdId: ctx.primaryHouseholdId,
    relationshipType: "ex_spouse",
    createdBy: ctx.userId,
  });
}

/** Finalize: record the commit result, invalidate P's projection caches, and
 *  write the audit + per-household activity records. */
async function finalize(tx: Tx, ctx: CommitCtx, spouseClientId: string): Promise<void> {
  await tx
    .update(divorcePlans)
    .set({ resultClientId: spouseClientId, committedAt: new Date(), updatedAt: new Date() })
    .where(eq(divorcePlans.id, ctx.plan.id));

  // P's cached projections are stale — its plan changed materially.
  await tx.delete(scenarioComputeCache).where(eq(scenarioComputeCache.clientId, ctx.plan.clientId));
  await tx.delete(solverMcCache).where(eq(solverMcCache.clientId, ctx.plan.clientId));

  // Audit (firm-wide) + activity (per-household). Both ride the module db and are
  // append-only; placed last so, in practice, only a successful commit reaches them.
  const counts = { primary: 0, spouse: 0, split: 0, duplicate: 0 };
  for (const a of ctx.resolved.values()) counts[a.disposition] += 1;
  await recordAudit({
    action: "divorce_plan.commit",
    resourceType: "divorce_plan",
    resourceId: ctx.plan.id,
    clientId: ctx.plan.clientId,
    firmId: ctx.firmId,
    metadata: { dispositions: counts, warnings: ctx.warnings, resultClientId: spouseClientId },
  });
  const now = new Date();
  for (const householdId of [ctx.spouseHouseholdId, ctx.primaryHouseholdId]) {
    await recordActivityNonFatal(
      {
        householdId,
        kind: "planning_link",
        title: "Household split — divorce planning commit",
        metadata: { divorcePlanId: ctx.plan.id, resultClientId: spouseClientId },
        occurredAt: now,
      },
      { actorUserId: ctx.userId },
      "divorce-commit",
    );
  }
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

      // P's default-checking account BEFORE any move clears its flag — lets
      // cleanup distinguish "the default moved to S" from "P never had one".
      const [priorDefault] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.clientId, clientId), eq(accounts.isDefaultChecking, true)))
        .limit(1);

      const ctx: CommitCtx = {
        plan,
        objects,
        resolved,
        firmId,
        userId,
        primaryHouseholdId: pClient.crmHouseholdId,
        cleanupSelections: preview.cleanup,
        priorDefaultCheckingId: priorDefault?.id ?? "",
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

      // ── Step 5: move mechanics + follow rules (T10) + entity moves/duplication
      // (T11). All S-bound re-homing happens here. ──
      await moveAllocatedObjects(tx, ctx);

      // ── Step 6: P-side cleanup + CRM ex_spouse edge, then finalize the draft
      // (result client, cache invalidation, audit + activity). ──
      await cleanupOriginal(tx, ctx);
      await finalize(tx, ctx, created.clientId);

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

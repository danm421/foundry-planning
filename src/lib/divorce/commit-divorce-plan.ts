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
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  divorcePlans,
  divorcePlanAllocations,
  clients,
  crmHouseholds,
  crmHouseholdContacts,
  familyMembers,
  scenarioSnapshots,
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
import { buildCommitPreview, type CommitPreview } from "./commit-preview";

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
  // Filled once the spouse side is minted (Step 3).
  spouseClientId: string;
  spouseScenarioId: string;
  spouseHouseholdId: string;
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
  // Ex-spouse P-row → S's role='client' row (seeded by createClientForHousehold).
  if (ctx.spouseFamilyMemberId) {
    const [sClientFm] = await tx
      .select({ id: familyMembers.id })
      .from(familyMembers)
      .where(and(eq(familyMembers.clientId, ctx.spouseClientId), eq(familyMembers.role, "client")))
      .limit(1);
    if (sClientFm) ctx.fmRemap.set(ctx.spouseFamilyMemberId, sClientFm.id);
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
  const { objects, primaryFamilyMemberId, spouseFamilyMemberId } =
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
        spouseClientId: created.clientId,
        spouseScenarioId: created.scenarioId,
        spouseHouseholdId,
        fmRemap: new Map(),
        extBenRemap: new Map(),
        entityRemap: new Map(),
        warnings: [],
      };

      // ── Step 4: family-member remap ──
      await mintSpouseFamilyMembers(tx, ctx);

      // ── Tasks 10–12 seam: account/income/expense/liability/entity moves +
      // splits + ride-alongs (T10–11), then P-side cleanup + CRM ex_spouse edge
      // + audit/activity (T12) run here, all on `tx` against `ctx`. ──

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

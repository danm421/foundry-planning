// Read-only commit preview for the divorce workbench.
//
// Re-runs the pure allocation resolution over live planning data and reports,
// without mutating anything, exactly what a commit would do: what BLOCKS it
// (unresolved joint objects, stray scenarios, incomplete spouse contact, an
// in-flight import), what it will DO (per-object moves/splits/duplicates),
// what it will WARN about (straddling links dropped, beneficiary designations
// that can't be carried onto the new file, cross-side links nulled), which
// spouse-naming beneficiary/will rows need CLEANUP, and what stays put
// (informational). The preview route (Task 8) renders it; the commit engine
// (Tasks 9–12) re-runs it as its precondition check.
//
// Org-scoping + authz happen at the route layer; the loader is read-only.
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  divorcePlans,
  divorcePlanAllocations,
  scenarios,
  clients,
  crmHouseholdContacts,
  familyMembers,
  clientImports,
  beneficiaryDesignations,
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
  liabilities,
  notesReceivable,
  taxReturns,
  relocations,
  planObservations,
  clientOpenItems,
} from "@/db/schema";
import {
  allocationKey,
  dispositionSides,
  resolveAllocations,
  type DivisibleObject,
  type DivorceDisposition,
  type DivorceTargetKind,
  type ResolvedAllocation,
} from "./allocation-rules";
import { loadDivisibleObjects, groupBy } from "./divisible-objects";
import { computeSideTotals, type SideTotals } from "./side-totals";
import { DivorcePlanError } from "./divorce-plans";

export type Side = "primary" | "spouse";

export interface CommitPreview {
  blockers: Array<{
    code: "unresolved_joint" | "non_base_scenarios" | "spouse_contact_incomplete" | "import_in_flight";
    label: string;
    count?: number;
  }>;
  totals: { primary: SideTotals & { name: string }; spouse: SideTotals & { name: string } };
  actions: Array<{
    kind: DivorceTargetKind;
    id: string;
    label: string;
    disposition: DivorceDisposition;
    detail: string;
  }>;
  warnings: Array<{
    code: "straddle_dropped" | "beneficiary_unresolvable" | "link_nulled";
    label: string;
    detail: string;
  }>;
  cleanup: Array<{
    source: "beneficiary_designation" | "will_bequest_recipient" | "will_residuary_recipient";
    id: string;
    label: string;
    side: Side;
    remove: boolean;
    // True when this row's removal is structurally forced and the "keep" choice
    // can't be honored: the designation references the departing spouse's P
    // family_member, which commit cleanup deletes — cascade-deleting the
    // designation (beneficiary_designations.family_member_id is ON DELETE
    // CASCADE) regardless of the checkbox. The dialog renders these
    // non-interactive. Two forced classes exist: (1) the departing spouse's P
    // family_member ref (cascade-deleted) and (2) a primary-named designation on
    // a container MOVED to the spouse, which the move drops regardless. Only ever
    // true for those; householdRole-based P-side strikes are struck by the
    // checklist and are never forced.
    forced: boolean;
    // When `forced`, the read-only reason shown under the row. Absent → the
    // dialog's default "removed with {spouse}'s family record" line (class 1).
    // Set for class 2 (moved-container strike) to explain the different cause.
    note?: string;
  }>;
  informational: string[];
}

type PersistedSelection = { source: string; id: string; remove: boolean };

// The destination side(s) a resolved allocation's ORIGINAL row lands on, for
// link-endpoint (straddle / cross-side-link) detection — NOT value distribution
// (totals/actions handle split's value on both books separately).
//
// Commit keeps the original account id on P for both `primary` and `split`: a
// split UPDATEs the original in place on P and INSERTs a NEW id for the spouse
// share (plan Task 11). Since every link references the ORIGINAL id, a split
// account is primary-only here — so a link from a split account to a
// spouse-destined endpoint straddles and must be dropped, never silently kept.
// `duplicate` deep-copies to S while keeping the original, so its id lives on
// both books.
export function linkEndpointSides(alloc: ResolvedAllocation | undefined): Set<Side> {
  return new Set(dispositionSides(alloc?.disposition));
}

// A link straddles when its endpoints share no common destination side.
export function straddles(sets: Set<Side>[]): boolean {
  const present = sets.filter((s) => s.size > 0);
  if (present.length < 2) return false;
  const common = present.reduce((acc, s) => new Set([...acc].filter((x) => s.has(x))));
  return common.size === 0;
}

// The side-resolution functions the preview AND the commit engine share, so the
// two can never disagree about which household an account or trust lands on. An
// account follows its entity when entity-owned; otherwise it follows its own
// resolved disposition. Pure over the loaded objects + resolved allocations.
export function buildSideResolvers(
  objects: DivisibleObject[],
  resolved: Map<string, ResolvedAllocation>,
): {
  accountSides: (accountId: string) => Set<Side>;
  entitySides: (entityId: string) => Set<Side>;
} {
  const accountObjById = new Map(
    objects.filter((o) => o.kind === "account").map((o) => [o.id, o]),
  );
  const entitySides = (entityId: string): Set<Side> =>
    linkEndpointSides(resolved.get(allocationKey("entity", entityId)));
  const accountSides = (accountId: string): Set<Side> => {
    const obj = accountObjById.get(accountId);
    if (!obj) return new Set();
    if (obj.entityOwnedById) return entitySides(obj.entityOwnedById);
    return linkEndpointSides(resolved.get(allocationKey("account", accountId)));
  };
  return { accountSides, entitySides };
}

export async function buildCommitPreview(args: {
  clientId: string;
  firmId: string;
}): Promise<CommitPreview> {
  const { clientId, firmId } = args;

  // Draft + divisible objects first — everything else is scoped by their ids.
  const [planRow, divis] = await Promise.all([
    db
      .select()
      .from(divorcePlans)
      .where(
        and(
          eq(divorcePlans.clientId, clientId),
          eq(divorcePlans.firmId, firmId),
          eq(divorcePlans.status, "draft"),
        ),
      )
      .limit(1),
    loadDivisibleObjects(clientId),
  ]);
  const plan = planRow[0];
  if (!plan) throw new DivorcePlanError("no_draft", "No live divorce draft for this client");

  const { objects, baseScenarioId, primaryFamilyMemberId, spouseFamilyMemberId } = divis;
  const expenseIds = objects.filter((o) => o.kind === "expense").map((o) => o.id);
  const fmIds = [primaryFamilyMemberId, spouseFamilyMemberId].filter((id): id is string => !!id);

  const [
    allocationRows,
    scenarioRows,
    importRows,
    spouseContactRows,
    fmRows,
    transferRows,
    reinvAcctRows,
    rothConvRows,
    rothSourceRows,
    assetTxnRows,
    edaRows,
    designationRows,
    bequestRecipientRows,
    residuaryRecipientRows,
    liabilityLinkRows,
    noteLinkRows,
    taxReturnRows,
    relocationRows,
    observationRows,
    openItemRows,
  ] = await Promise.all([
    db
      .select({
        targetKind: divorcePlanAllocations.targetKind,
        targetId: divorcePlanAllocations.targetId,
        disposition: divorcePlanAllocations.disposition,
        splitPercentToSpouse: divorcePlanAllocations.splitPercentToSpouse,
      })
      .from(divorcePlanAllocations)
      .where(eq(divorcePlanAllocations.divorcePlanId, plan.id)),
    db
      .select({ isBaseCase: scenarios.isBaseCase })
      .from(scenarios)
      .where(eq(scenarios.clientId, clientId)),
    db
      .select({ id: clientImports.id })
      .from(clientImports)
      .where(
        and(
          eq(clientImports.clientId, clientId),
          inArray(clientImports.status, ["extracting", "review"]),
        ),
      ),
    db
      .select({
        firstName: crmHouseholdContacts.firstName,
        lastName: crmHouseholdContacts.lastName,
        dateOfBirth: crmHouseholdContacts.dateOfBirth,
      })
      .from(crmHouseholdContacts)
      .innerJoin(clients, eq(clients.crmHouseholdId, crmHouseholdContacts.householdId))
      .where(
        and(
          eq(clients.id, clientId),
          eq(clients.firmId, firmId),
          eq(crmHouseholdContacts.role, "spouse"),
        ),
      )
      .limit(1),
    fmIds.length
      ? db
          .select({
            id: familyMembers.id,
            firstName: familyMembers.firstName,
            lastName: familyMembers.lastName,
          })
          .from(familyMembers)
          .where(inArray(familyMembers.id, fmIds))
      : Promise.resolve([] as { id: string; firstName: string; lastName: string | null }[]),
    db
      .select({
        name: transfers.name,
        sourceAccountId: transfers.sourceAccountId,
        targetAccountId: transfers.targetAccountId,
      })
      .from(transfers)
      .where(and(eq(transfers.clientId, clientId), eq(transfers.scenarioId, baseScenarioId))),
    db
      .select({
        reinvestmentId: reinvestments.id,
        name: reinvestments.name,
        accountId: reinvestmentAccounts.accountId,
      })
      .from(reinvestmentAccounts)
      .innerJoin(reinvestments, eq(reinvestmentAccounts.reinvestmentId, reinvestments.id))
      .where(
        and(eq(reinvestments.clientId, clientId), eq(reinvestments.scenarioId, baseScenarioId)),
      ),
    db
      .select({
        id: rothConversions.id,
        name: rothConversions.name,
        destinationAccountId: rothConversions.destinationAccountId,
      })
      .from(rothConversions)
      .where(
        and(eq(rothConversions.clientId, clientId), eq(rothConversions.scenarioId, baseScenarioId)),
      ),
    db
      .select({
        rothConversionId: rothConversionSources.rothConversionId,
        accountId: rothConversionSources.accountId,
      })
      .from(rothConversionSources)
      .innerJoin(rothConversions, eq(rothConversionSources.rothConversionId, rothConversions.id))
      .where(
        and(eq(rothConversions.clientId, clientId), eq(rothConversions.scenarioId, baseScenarioId)),
      ),
    db
      .select({
        name: assetTransactions.name,
        accountId: assetTransactions.accountId,
        proceedsAccountId: assetTransactions.proceedsAccountId,
        fundingAccountId: assetTransactions.fundingAccountId,
        businessAccountId: assetTransactions.businessAccountId,
      })
      .from(assetTransactions)
      .where(
        and(
          eq(assetTransactions.clientId, clientId),
          eq(assetTransactions.scenarioId, baseScenarioId),
        ),
      ),
    expenseIds.length
      ? db
          .select({
            expenseId: expenseDedicatedAccounts.expenseId,
            accountId: expenseDedicatedAccounts.accountId,
          })
          .from(expenseDedicatedAccounts)
          .where(inArray(expenseDedicatedAccounts.expenseId, expenseIds))
      : Promise.resolve([] as { expenseId: string; accountId: string }[]),
    db
      .select({
        id: beneficiaryDesignations.id,
        accountId: beneficiaryDesignations.accountId,
        entityId: beneficiaryDesignations.entityId,
        familyMemberId: beneficiaryDesignations.familyMemberId,
        householdRole: beneficiaryDesignations.householdRole,
      })
      .from(beneficiaryDesignations)
      .where(eq(beneficiaryDesignations.clientId, clientId)),
    db
      .select({
        id: willBequestRecipients.id,
        recipientKind: willBequestRecipients.recipientKind,
        recipientId: willBequestRecipients.recipientId,
        grantor: wills.grantor,
        bequestName: willBequests.name,
      })
      .from(willBequestRecipients)
      .innerJoin(willBequests, eq(willBequestRecipients.bequestId, willBequests.id))
      .innerJoin(wills, eq(willBequests.willId, wills.id))
      .where(eq(wills.clientId, clientId)),
    db
      .select({
        id: willResiduaryRecipients.id,
        recipientKind: willResiduaryRecipients.recipientKind,
        recipientId: willResiduaryRecipients.recipientId,
        grantor: wills.grantor,
      })
      .from(willResiduaryRecipients)
      .innerJoin(wills, eq(willResiduaryRecipients.willId, wills.id))
      .where(eq(wills.clientId, clientId)),
    db
      .select({ id: liabilities.id, name: liabilities.name, linkedPropertyId: liabilities.linkedPropertyId })
      .from(liabilities)
      .where(and(eq(liabilities.clientId, clientId), eq(liabilities.scenarioId, baseScenarioId))),
    db
      .select({
        id: notesReceivable.id,
        name: notesReceivable.name,
        linkedTrustEntityId: notesReceivable.linkedTrustEntityId,
      })
      .from(notesReceivable)
      .where(
        and(eq(notesReceivable.clientId, clientId), eq(notesReceivable.scenarioId, baseScenarioId)),
      ),
    db.select({ id: taxReturns.id }).from(taxReturns).where(eq(taxReturns.clientId, clientId)).limit(1),
    db.select({ id: relocations.id }).from(relocations).where(eq(relocations.clientId, clientId)).limit(1),
    db.select({ id: planObservations.id }).from(planObservations).where(eq(planObservations.clientId, clientId)).limit(1),
    db.select({ id: clientOpenItems.id }).from(clientOpenItems).where(eq(clientOpenItems.clientId, clientId)).limit(1),
  ]);

  const resolved = resolveAllocations(objects, allocationRows);

  // ── Names + totals ──
  const nameById = new Map(
    fmRows.map((fm) => [fm.id, `${fm.firstName} ${fm.lastName ?? ""}`.trim()]),
  );
  const primaryName = nameById.get(primaryFamilyMemberId) ?? "";
  const spouseName = (spouseFamilyMemberId && nameById.get(spouseFamilyMemberId)) || "";
  const primaryFirst = primaryName.split(/\s+/)[0] || "the primary";
  const nameForSide = (s: Side) => (s === "primary" ? primaryName : spouseName);

  const baseTotals = computeSideTotals(objects, resolved);
  const totals = {
    primary: { ...baseTotals.primary, name: primaryName },
    spouse: { ...baseTotals.spouse, name: spouseName },
  };

  // ── Side resolvers over the resolved map (shared with the commit engine) ──
  const accountObjById = new Map(objects.filter((o) => o.kind === "account").map((o) => [o.id, o]));
  const expenseLabelById = new Map(
    objects.filter((o) => o.kind === "expense").map((o) => [o.id, o.label]),
  );
  const { accountSides, entitySides } = buildSideResolvers(objects, resolved);

  // ── Blockers ──
  const blockers: CommitPreview["blockers"] = [];
  const unresolvedCount = [...resolved.values()].filter((a) => a.needsDecision).length;
  if (unresolvedCount > 0) {
    blockers.push({
      code: "unresolved_joint",
      label: `${unresolvedCount} joint item${unresolvedCount === 1 ? "" : "s"} still need${unresolvedCount === 1 ? "s" : ""} an allocation decision`,
      count: unresolvedCount,
    });
  }
  const nonBaseCount = scenarioRows.filter((s) => !s.isBaseCase).length;
  if (nonBaseCount > 0) {
    blockers.push({
      code: "non_base_scenarios",
      label: `${nonBaseCount} non-base scenario${nonBaseCount === 1 ? "" : "s"} must be promoted or discarded first`,
      count: nonBaseCount,
    });
  }
  const spouseContact = spouseContactRows[0];
  if (
    !spouseContact ||
    !spouseContact.firstName?.trim() ||
    !spouseContact.lastName?.trim() ||
    !spouseContact.dateOfBirth
  ) {
    blockers.push({
      code: "spouse_contact_incomplete",
      label: "The spouse contact is missing a name or date of birth",
    });
  }
  if (importRows.length > 0) {
    blockers.push({
      code: "import_in_flight",
      label: "An import is in progress — finish or discard it before committing",
      count: importRows.length,
    });
  }

  // ── Actions (only the moves that change something) ──
  const actions: CommitPreview["actions"] = [];
  for (const obj of objects) {
    if (obj.entityOwnedById) continue;
    const alloc = resolved.get(allocationKey(obj.kind, obj.id));
    if (!alloc || alloc.disposition === "primary") continue;
    let detail: string;
    if (alloc.disposition === "spouse") detail = `moves to ${spouseName}`;
    else if (alloc.disposition === "split") {
      detail = `split ${alloc.splitPercentToSpouse ?? 0}% to ${spouseName}`;
    } else detail = "duplicated to both households";
    actions.push({ kind: obj.kind, id: obj.id, label: obj.label, disposition: alloc.disposition, detail });
  }

  // ── Warnings: straddling links ──
  const warnings: CommitPreview["warnings"] = [];
  for (const t of transferRows) {
    if (straddles([accountSides(t.sourceAccountId), accountSides(t.targetAccountId)])) {
      warnings.push({
        code: "straddle_dropped",
        label: t.name,
        detail: "Transfers between accounts landing on different households — dropped on commit.",
      });
    }
  }
  for (const [, rows] of groupBy(reinvAcctRows, (r) => r.reinvestmentId)) {
    if (straddles(rows.map((r) => accountSides(r.accountId)))) {
      warnings.push({
        code: "straddle_dropped",
        label: rows[0].name,
        detail: "Reinvestment spans accounts on different households — dropped on commit.",
      });
    }
  }
  const rothSourcesByConv = groupBy(rothSourceRows, (r) => r.rothConversionId);
  for (const c of rothConvRows) {
    const sets = [
      accountSides(c.destinationAccountId),
      ...(rothSourcesByConv.get(c.id) ?? []).map((s) => accountSides(s.accountId)),
    ];
    if (straddles(sets)) {
      warnings.push({
        code: "straddle_dropped",
        label: c.name,
        detail: "Roth conversion draws from and lands in accounts on different households — dropped on commit.",
      });
    }
  }
  for (const a of assetTxnRows) {
    const ids = [a.accountId, a.proceedsAccountId, a.fundingAccountId, a.businessAccountId].filter(
      (x): x is string => !!x,
    );
    if (ids.length >= 2 && straddles(ids.map(accountSides))) {
      warnings.push({
        code: "straddle_dropped",
        label: a.name,
        detail: "Buy/sell links accounts on different households — dropped on commit.",
      });
    }
  }
  for (const e of edaRows) {
    const expSides = linkEndpointSides(resolved.get(allocationKey("expense", e.expenseId)));
    if (straddles([expSides, accountSides(e.accountId)])) {
      const label = expenseLabelById.get(e.expenseId) ?? "Expense";
      const acctLabel = accountObjById.get(e.accountId)?.label ?? "an account";
      warnings.push({
        code: "straddle_dropped",
        label,
        detail: `Funded from ${acctLabel}, which lands on the other household — funding link dropped on commit.`,
      });
    }
  }

  // ── Warnings: cross-side links nulled ──
  for (const l of liabilityLinkRows) {
    if (!l.linkedPropertyId) continue;
    const libSides = linkEndpointSides(resolved.get(allocationKey("liability", l.id)));
    if (straddles([libSides, accountSides(l.linkedPropertyId)])) {
      warnings.push({
        code: "link_nulled",
        label: l.name,
        detail: "Secured property lands on the other household — the property link is cleared on commit.",
      });
    }
  }
  for (const n of noteLinkRows) {
    if (!n.linkedTrustEntityId) continue;
    const noteSides = linkEndpointSides(resolved.get(allocationKey("note_receivable", n.id)));
    if (straddles([noteSides, entitySides(n.linkedTrustEntityId)])) {
      warnings.push({
        code: "link_nulled",
        label: n.name,
        detail: "Linked trust lands on the other household — the trust link is cleared on commit.",
      });
    }
  }

  // ── Cleanup (bidirectional) + beneficiary_unresolvable ──
  const familyMemberSide = new Map<string, Side>();
  if (primaryFamilyMemberId) familyMemberSide.set(primaryFamilyMemberId, "primary");
  if (spouseFamilyMemberId) familyMemberSide.set(spouseFamilyMemberId, "spouse");

  const cleanupRaw: Array<Omit<CommitPreview["cleanup"][number], "remove">> = [];

  for (const des of designationRows) {
    const belongsSides = des.accountId
      ? accountSides(des.accountId)
      : des.entityId
        ? entitySides(des.entityId)
        : new Set<Side>();
    if (belongsSides.size === 0) continue;

    let namedSide: Side | null = null;
    if (des.householdRole) namedSide = des.householdRole === "spouse" ? "spouse" : "primary";
    else if (des.familyMemberId) namedSide = familyMemberSide.get(des.familyMemberId) ?? null;

    if (namedSide) {
      // A household principal (the soon-to-be-ex) named on a document that lands
      // on the OTHER side → offer to strike them. `des.id` is ALWAYS the P-side
      // row: a strike is only executable-by-id when the container's P copy still
      // carries it (a primary-side strike). Spouse-side removals are informational
      // — the S copy is a different row (minted by the move/duplicate paths).
      const objLabel = des.accountId ? accountObjById.get(des.accountId)?.label ?? "Account" : "Trust";
      const label = `${objLabel} names ${nameForSide(namedSide)}`;
      for (const side of belongsSides) {
        if (side === namedSide) continue;
        if (side === "primary") {
          // The container's P copy names the departing spouse → strike from P
          // (step 6 executes it by id). Forced iff the row rides the spouse's P
          // family_member (cascade-deleted whatever the checkbox says);
          // householdRole-based rows carry no fm ref, so they're struck by the
          // checklist and never forced.
          cleanupRaw.push({
            source: "beneficiary_designation",
            id: des.id,
            label,
            side,
            forced: des.familyMemberId != null && des.familyMemberId === spouseFamilyMemberId,
          });
        } else {
          // side === "spouse", namedSide === "primary": the designation names the
          // PRIMARY, who can't be carried onto S. When the container ALSO lands on
          // the primary (duplicate), the P copy keeps this row and the S copy
          // simply never receives it (duplicateTrustDesignations skips
          // primary-named) — striking des.id would destroy the legitimate P copy,
          // so surface nothing (C1). When the container MOVED to the spouse, the
          // move (moveDesignationRow) drops it regardless of the checkbox →
          // forced, and step 6 skips spouse-side rows (I4).
          if (belongsSides.has("primary")) continue;
          cleanupRaw.push({
            source: "beneficiary_designation",
            id: des.id,
            label,
            side,
            forced: true,
            note: `Removed with the move — ${primaryFirst} can't be named on the new household's account.`,
          });
        }
      }
      continue;
    }

    // A non-principal family member (child/other) named on a spouse-destined
    // account who won't reach the spouse's household → the designation can't be
    // re-pointed and is dropped. Family members default to duplicate (which does
    // reach S), so only an explicit primary strands it.
    if (des.familyMemberId && belongsSides.has("spouse")) {
      const disp = resolved.get(allocationKey("family_member", des.familyMemberId))?.disposition;
      if (disp === "primary") {
        warnings.push({
          code: "beneficiary_unresolvable",
          label: des.accountId ? accountObjById.get(des.accountId)?.label ?? "Account" : "Trust",
          detail:
            "A beneficiary who stays with the other household can't be carried onto the new file — the designation is dropped on commit.",
        });
      }
    }
  }

  const willSide = (grantor: "client" | "spouse"): Side => (grantor === "spouse" ? "spouse" : "primary");
  const recipientNamedSide = (kind: string, namedId: string | null): Side | null => {
    if (kind === "spouse") return "spouse";
    if (kind === "family_member" && namedId) return familyMemberSide.get(namedId) ?? null;
    return null;
  };
  for (const r of bequestRecipientRows) {
    const ws = willSide(r.grantor);
    const ns = recipientNamedSide(r.recipientKind, r.recipientId);
    if (ns && ns !== ws) {
      cleanupRaw.push({
        source: "will_bequest_recipient",
        id: r.id,
        label: `${r.bequestName} names ${nameForSide(ns)}`,
        side: ws,
        // will_*_recipients.recipient_id is a polymorphic uuid, NOT an fm FK, so
        // the spouse-fm delete never cascades it — the checklist strikes it.
        forced: false,
      });
    }
  }
  for (const r of residuaryRecipientRows) {
    const ws = willSide(r.grantor);
    const ns = recipientNamedSide(r.recipientKind, r.recipientId);
    if (ns && ns !== ws) {
      cleanupRaw.push({
        source: "will_residuary_recipient",
        id: r.id,
        label: `Residuary estate names ${nameForSide(ns)}`,
        side: ws,
        forced: false,
      });
    }
  }

  // Merge with persisted checklist decisions — a persisted remove:false wins
  // over the default true (advisor chose to keep the designation).
  const persistedSelections =
    (plan.beneficiaryCleanup as { selections?: PersistedSelection[] } | null)?.selections ?? [];
  const persisted = new Map(persistedSelections.map((s) => [`${s.source}:${s.id}`, s.remove]));
  const cleanup: CommitPreview["cleanup"] = cleanupRaw.map((c) => ({
    ...c,
    remove: persisted.get(`${c.source}:${c.id}`) ?? true,
  }));

  // ── Informational (stays with the primary) ──
  const informational: string[] = [];
  if (taxReturnRows.length > 0) informational.push(`Tax returns stay with ${primaryName}`);
  if (relocationRows.length > 0) informational.push(`Relocation events stay with ${primaryName}`);
  if (openItemRows.length > 0) informational.push(`Open items stay with ${primaryName}`);
  if (observationRows.length > 0) {
    informational.push(`Observations & next steps stay with ${primaryName}`);
  }

  return { blockers, totals, actions, warnings, cleanup, informational };
}

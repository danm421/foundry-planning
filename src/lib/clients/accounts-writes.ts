// Account write-core. The single validation + write path shared by the API
// routes (src/app/api/clients/[id]/accounts/**) and the Forge write tools, so
// route and agent can never drift. Cloned from liabilities-writes.ts — the shared
// baseCaseScenarioId helper (./base-case), same writeError / {ok:true,...} shape,
// same snapshot-based audit and tx-wrapped owners satellite.
//
// Lifted verbatim from the route bodies: base-case scenario lookup, the business
// pre-branch normalization, the entity / model-portfolio / ticker-portfolio /
// parent-business FK asserts on CREATE, the parent-vs-owners mutual-exclusion
// guard, the owners[] resolve/synthesis, the transactional insert/update/delete
// of the accounts row + its accountOwners satellite, the auto-provisioned child
// cash account, orphan-change prune, and the snapshot-based account.{create,
// update,delete} audit. The only generic deltas vs the route: firmId/actorId are
// passed in (the route reads them from Clerk via requireOrgId()/auth()), and
// NextResponse.json(...) becomes writeError(...) / {ok:true,...}.
//
// Account-specific notes (deltas vs expenses/incomes/liabilities cores):
//   • BUSINESS PRE-BRANCH + subType DERIVE: when category === "business" the core
//     re-runs AddBusinessInputSchema (which COERCES owners[].percent to NUMBERS
//     and value/basis to numbers) and merges its data back over the raw body,
//     then derives sub_type from businessType via mapBusinessTypeToSubType (never
//     honoring a client-supplied subType for business rows). The merge is
//     load-bearing: validateOwnersShape below requires numeric percents, and the
//     create schema's superRefine only *validates* business — it does NOT derive
//     subType or coerce owners. mapBusinessTypeToSubType is copied here (it is NOT
//     exported from the route).
//   • UPDATE uses MASS-ASSIGN-STRIP + SPREAD, NOT a zod whitelist. The PUT route
//     is a permissive "update any column" endpoint: it strips the 4 identity
//     fields (id/clientId/createdAt/updatedAt) then spreads `...accountUpdate`
//     straight into .set(). A zod whitelist would silently DROP legitimately-
//     updatable columns the schema doesn't enumerate — most importantly
//     `deriveFromHoldings` (which triggers the post-commit sync) and `notes`. So
//     this core mirrors the route's strip+spread faithfully instead of parsing.
//   • custodian / accountNumberLast4 collapse empty-string → null via `|| null`
//     (the collapse Task 13's schema deferred to the core; an empty CurrencyInput
//     / text input must store null, not "").
//   • AUTO-PROVISION CHILD CASH: every new top-level business (category ===
//     "business" && parentAccountId == null) gets a child default-checking cash
//     account inserted in the same tx — the Phase-3 engine routes business
//     income/expense/retained-earnings through this exact row. Children inherit
//     ownership via parentAccountId, so they carry NO accountOwners rows.
//   • POST-COMMIT SYNC ON UPDATE ONLY: when an update sets
//     deriveFromHoldings === true, syncAccountFromHoldings(accountId) runs AFTER
//     the tx + audit (matching the PUT route). CREATE never syncs (the POST route
//     doesn't call it).
//   • isDefaultChecking SYSTEM-MANAGED GUARDS: on UPDATE, a default-checking row
//     rejects changes to category / subType / parentAccountId / ownership; on
//     DELETE it rejects deletion outright (the default-checking check runs BEFORE
//     the 404, mirroring the route's ordering).
//   • actorId forwarding: recordCreate/recordUpdate/recordDelete receive actorId
//     explicitly (they accept `actorId?`) — matches the three shipped cores.
import { db } from "@/db";
import { accounts, accountOwners } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { verifyClientAccess } from "@/lib/clients/authz";
import {
  assertAccountsInClient,
  assertEntitiesInClient,
  assertModelPortfoliosInFirm,
  assertTickerPortfoliosInFirm,
} from "@/lib/db-scoping";
import { recordCreate, recordUpdate, recordDelete } from "@/lib/audit";
import { toAccountSnapshot, ACCOUNT_FIELD_LABELS } from "@/lib/audit/snapshots/account";
import { pruneOrphanScenarioChanges } from "@/lib/scenario/prune-changes";
import { formatZodIssues } from "@/lib/schemas/common";
import {
  type ValidatedOwner,
  validateOwnersShape,
  validateOwnersTenant,
  validateAccountOwnershipRules,
  synthesizeLegacyAccountOwners,
} from "@/lib/ownership";
import { accountCreateSchema } from "@/lib/schemas/accounts";
import { AddBusinessInputSchema } from "@/lib/schemas/accounts-business";
import { syncAccountFromHoldings } from "@/lib/investments/sync-account-from-holdings";
import { baseCaseScenarioId } from "./base-case";
import { writeError, type EntityWriteResult } from "./entity-write-result";

type AccountRow = typeof accounts.$inferSelect;

/** Map the business-type enum to the analogous `account_sub_type` value so
 *  accounts.sub_type stays consistent with category-specific UIs that filter
 *  on it. `other` business types fall through to the generic `other` sub-type.
 *  Copied verbatim from the POST route (it is NOT exported there). */
function mapBusinessTypeToSubType(
  bt: "sole_prop" | "partnership" | "s_corp" | "c_corp" | "llc" | "other",
): "sole_proprietorship" | "partnership" | "s_corp" | "c_corp" | "llc" | "other" {
  switch (bt) {
    case "sole_prop":
      return "sole_proprietorship";
    case "partnership":
      return "partnership";
    case "s_corp":
      return "s_corp";
    case "c_corp":
      return "c_corp";
    case "llc":
      return "llc";
    default:
      return "other";
  }
}

export async function createAccountForClient(args: {
  clientId: string;
  firmId: string;
  actorId: string;
  input: unknown;
  crossFirmMeta?: Record<string, unknown>;
}): Promise<EntityWriteResult<AccountRow>> {
  const { clientId, firmId, actorId, input, crossFirmMeta } = args;

  const scenarioId = await baseCaseScenarioId(clientId, firmId);
  if (!scenarioId) return writeError(404, "Client not found");

  // ── Business pre-branch (port of POST ~104-125) ───────────────────────────
  // For business accounts, re-run the dedicated schema to COERCE owners[].percent
  // to numbers + value/basis to numbers, then merge its data over the raw body and
  // DERIVE sub_type from businessType. Always derive sub_type — never honor a
  // client-supplied subType on a business row.
  const rawInput = input as Record<string, unknown>;
  let mergedInput: Record<string, unknown>;
  if (rawInput?.category === "business") {
    const b = AddBusinessInputSchema.safeParse(rawInput);
    if (!b.success) {
      return writeError(400, b.error.issues[0]?.message ?? "Invalid business input");
    }
    mergedInput = {
      ...rawInput,
      ...b.data,
      subType: mapBusinessTypeToSubType(b.data.businessType),
    };
  } else {
    mergedInput = rawInput;
  }

  const parsed = accountCreateSchema.safeParse(mergedInput);
  if (!parsed.success) {
    return writeError(400, formatZodIssues(parsed.error).map((i) => i.message).join("; "));
  }
  const p = parsed.data;
  const category = p.category;

  // ── 529 (education_savings) beneficiary requirement (spec, not a route port) ──
  // A 529 must be attributed to a designated beneficiary — either a household
  // family member or a named outside person. Fail fast, before any FK asserts.
  if (category === "education_savings") {
    if (!p.beneficiaryFamilyMemberId && !p.beneficiaryName?.trim()) {
      return writeError(400, "A 529 requires a designated beneficiary (family member or name).");
    }
  }

  // ── Cross-tenant / cross-firm FK asserts (port ~161-192) ──────────────────
  const entCheck = await assertEntitiesInClient(clientId, [p.ownerEntityId]);
  if (!entCheck.ok) return writeError(400, entCheck.reason);

  const mpCheck = await assertModelPortfoliosInFirm(firmId, [p.modelPortfolioId]);
  if (!mpCheck.ok) return writeError(400, mpCheck.reason);

  const tpCheck = await assertTickerPortfoliosInFirm(firmId, [p.tickerPortfolioId]);
  if (!tpCheck.ok) return writeError(400, tpCheck.reason);

  // parentAccountId may be set on any category. Verify the referenced row is in
  // this client AND is a business account — the DB FK only checks existence.
  if (p.parentAccountId != null) {
    const parentCheck = await assertAccountsInClient(clientId, [p.parentAccountId]);
    if (!parentCheck.ok) return writeError(400, parentCheck.reason);
    const [parentRow] = await db
      .select({ category: accounts.category })
      .from(accounts)
      .where(eq(accounts.id, p.parentAccountId));
    if (!parentRow || parentRow.category !== "business") {
      return writeError(400, "parentAccountId must reference a business account");
    }
  }

  // ── owners[] validation (port ~194-247) ───────────────────────────────────
  let resolvedOwners: ValidatedOwner[] | undefined;

  if (category === "education_savings") {
    // 529s carry no ownership rows — the beneficiary fields (validated above)
    // are authoritative; a sentinel owner is synthesized at engine-load time.
    resolvedOwners = undefined;
  } else if (p.parentAccountId != null) {
    // Children of a business inherit their ownership via parentAccountId. Skip
    // both the owners[] write and the legacy synthesis path so we don't create
    // stray account_owners rows.
    if (Array.isArray(p.owners) && p.owners.length > 0) {
      return writeError(400, "An account cannot have both a parent business and explicit owners");
    }
    resolvedOwners = undefined;
  } else if (p.owners !== undefined) {
    // New owners[] path. (zod .optional() collapses absent → undefined, faithfully
    // reproducing the route's `"owners" in body && body.owners !== undefined`.)
    const shapeResult = validateOwnersShape(p.owners);
    if ("error" in shapeResult) return writeError(400, shapeResult.error);
    const rulesError = validateAccountOwnershipRules(
      shapeResult.owners,
      p.subType ?? "other",
      p.isDefaultChecking ?? false,
    );
    if (rulesError) return writeError(400, rulesError.error);
    const tenantError = await validateOwnersTenant(shapeResult.owners, clientId);
    if (tenantError) return writeError(400, tenantError.error);
    resolvedOwners = shapeResult.owners;
  } else {
    // Legacy path: synthesize owners from legacy fields so account is never orphaned.
    const synthesized = await synthesizeLegacyAccountOwners(
      clientId,
      p.owner,
      p.ownerEntityId,
      p.ownerFamilyMemberId,
    );
    if (synthesized.length > 0) resolvedOwners = synthesized;
  }
  // ── end owners[] validation ───────────────────────────────────────────────

  // Insert values come straight off the parsed object — the schema already coerced
  // every field (decOrZero → "0"-defaulted strings, ?? null applied for nullable
  // FKs, defaults for subType/growthSource/titlingType/etc.). The business-only
  // columns + hsaCoverage + the custodian/last4 `|| null` collapse stay in the
  // core, mirroring the route's insert block (POST ~259-303).
  let account: AccountRow;
  await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(accounts)
      .values({
        clientId,
        scenarioId,
        name: p.name,
        category: category as AccountRow["category"],
        subType: (p.subType ?? "other") as AccountRow["subType"],
        value: p.value,
        basis: p.basis,
        rothValue: p.rothValue,
        // null = inherit the default growth rate for this category from plan_settings.
        growthRate: p.growthRate == null ? null : String(p.growthRate),
        rmdEnabled: p.rmdEnabled,
        countsTowardAum: p.countsTowardAum,
        priorYearEndValue: p.priorYearEndValue == null ? null : String(p.priorYearEndValue),
        growthSource: p.growthSource as AccountRow["growthSource"],
        modelPortfolioId: p.modelPortfolioId ?? null,
        tickerPortfolioId: p.tickerPortfolioId ?? null,
        turnoverPct: String(p.turnoverPct),
        overridePctOi: p.overridePctOi == null ? null : String(p.overridePctOi),
        overridePctLtCg: p.overridePctLtCg == null ? null : String(p.overridePctLtCg),
        overridePctQdiv: p.overridePctQdiv == null ? null : String(p.overridePctQdiv),
        overridePctTaxExempt: p.overridePctTaxExempt == null ? null : String(p.overridePctTaxExempt),
        annualPropertyTax: String(p.annualPropertyTax),
        propertyTaxGrowthRate: String(p.propertyTaxGrowthRate),
        propertyTaxGrowthSource: p.propertyTaxGrowthSource as AccountRow["propertyTaxGrowthSource"],
        titlingType: p.titlingType as AccountRow["titlingType"],
        // Business-only columns (null for non-business categories).
        businessType:
          category === "business" ? ((p.businessType ?? null) as AccountRow["businessType"]) : null,
        distributionPolicyPercent:
          category === "business" && p.distributionPolicyPercent != null
            ? String(p.distributionPolicyPercent)
            : null,
        // flowMode has a NOT NULL default of 'annual' at the DB layer.
        flowMode: (category === "business" ? (p.flowMode ?? "annual") : "annual") as AccountRow["flowMode"],
        businessTaxTreatment:
          category === "business"
            ? ((p.businessTaxTreatment ?? "qbi") as AccountRow["businessTaxTreatment"])
            : null,
        // parentAccountId allowed on any category — tenant + business-target-validated above.
        parentAccountId: p.parentAccountId ?? null,
        // hsaCoverage is only meaningful for HSA retirement accounts; null otherwise.
        hsaCoverage:
          category === "retirement" && (p.subType ?? "other") === "hsa"
            ? p.hsaCoverage === "family"
              ? "family"
              : "self"
            : null,
        // Collapse empty-string custodian / last4 to null (the `|| null` Task 13 deferred).
        custodian: (p.custodian ?? null) || null,
        accountNumberLast4: (p.accountNumberLast4 ?? null) || null,
        activationYear: p.activationYear ?? null,
        activationYearRef: (p.activationYearRef ?? null) as (typeof accounts.$inferInsert)["activationYearRef"],
        // 529 / education_savings columns — null/false for every other category.
        grantorFamilyMemberId: p.grantorFamilyMemberId ?? null,
        grantorName: p.grantorName ?? null,
        beneficiaryFamilyMemberId: p.beneficiaryFamilyMemberId ?? null,
        beneficiaryName: p.beneficiaryName ?? null,
        rothRolloverEnabled: p.rothRolloverEnabled ?? false,
        rothRolloverStartYear: p.rothRolloverStartYear ?? null,
        rothRolloverAccountId: p.rothRolloverAccountId ?? null,
      })
      .returning();
    account = inserted;

    if (resolvedOwners && resolvedOwners.length > 0) {
      for (const o of resolvedOwners) {
        await tx.insert(accountOwners).values({
          accountId: account.id,
          familyMemberId: o.kind === "family_member" ? o.familyMemberId : null,
          entityId: o.kind === "entity" ? o.entityId : null,
          percent: o.percent.toString(),
        });
      }
    }

    // Auto-provision a child default-checking cash account on every new top-level
    // business. The Phase-3 engine looks for this exact row to route business
    // income/expense and retained earnings. Children inherit ownership via
    // parentAccountId — no account_owners rows. isDefaultChecking=true brings the
    // PUT/DELETE guards along (category / sub-type / parent / ownership / deletion
    // are all locked). (Port of POST ~328-350.)
    if (category === "business" && p.parentAccountId == null) {
      await tx.insert(accounts).values({
        clientId,
        scenarioId,
        name: `${p.name} — Cash`,
        category: "cash",
        subType: "checking",
        value: "0",
        basis: "0",
        rothValue: "0",
        growthRate: null,
        rmdEnabled: false,
        growthSource: "default",
        turnoverPct: "0",
        annualPropertyTax: "0",
        propertyTaxGrowthRate: "0.03",
        propertyTaxGrowthSource: "custom",
        titlingType: "jtwros",
        flowMode: "annual",
        parentAccountId: account.id,
        isDefaultChecking: true,
      });
    }
  });

  await recordCreate({
    action: "account.create",
    resourceType: "account",
    resourceId: account!.id,
    clientId,
    firmId,
    actorId,
    snapshot: await toAccountSnapshot(account!),
    extraMetadata: crossFirmMeta,
  });

  return { ok: true, data: account!, resourceId: account!.id };
}

export async function updateAccountForClient(args: {
  clientId: string;
  firmId: string;
  actorId: string;
  accountId: string;
  input: unknown;
  crossFirmMeta?: Record<string, unknown>;
}): Promise<EntityWriteResult<AccountRow>> {
  const { clientId, firmId, actorId, accountId, input, crossFirmMeta } = args;

  const a = await verifyClientAccess(clientId);
  if (!a.ok || a.firmId !== firmId) {
    return writeError(404, "Client not found");
  }

  // Mass-assign strip (port ~42-50): the PUT route is permissive — it strips the 4
  // identity/tenancy fields then spreads the rest. We do NOT zod-parse: a whitelist
  // would silently drop legitimately-updatable columns (deriveFromHoldings, notes,
  // …). See file header.
  //
  // plaidItemId / plaidAccountId are ALSO stripped: they are Plaid-managed link
  // columns, never advisor-editable through this route. The whole lib/plaid layer
  // scopes reads/writes by plaidItemId alone (refresh, sync, unlink), so a forged
  // pair here could point an account at another client's Plaid item — a tenant-
  // isolation break. They are only ever set by the Plaid link/exchange flows.
  const body = input as Record<string, unknown>;
  const {
    id: _stripId,
    clientId: _stripClientId,
    createdAt: _stripCreatedAt,
    updatedAt: _stripUpdatedAt,
    plaidItemId: _stripPlaidItemId,
    plaidAccountId: _stripPlaidAccountId,
    ...safeUpdate
  } = body;
  void _stripId;
  void _stripClientId;
  void _stripCreatedAt;
  void _stripUpdatedAt;
  void _stripPlaidItemId;
  void _stripPlaidAccountId;

  // Cross-tenant FK asserts on the present keys (port ~55-66).
  if ("ownerEntityId" in safeUpdate) {
    const c = await assertEntitiesInClient(clientId, [safeUpdate.ownerEntityId as string | null]);
    if (!c.ok) return writeError(400, c.reason);
  }
  if ("modelPortfolioId" in safeUpdate) {
    const c = await assertModelPortfoliosInFirm(firmId, [safeUpdate.modelPortfolioId as string | null]);
    if (!c.ok) return writeError(400, c.reason);
  }
  if ("tickerPortfolioId" in safeUpdate) {
    const c = await assertTickerPortfoliosInFirm(firmId, [safeUpdate.tickerPortfolioId as string | null]);
    if (!c.ok) return writeError(400, c.reason);
  }

  const [before] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.clientId, clientId)));

  if (!before) return writeError(404, "Account not found");

  // ── 529 (education_savings) beneficiary requirement (spec, not a route port) ──
  // Mirrors the create-path check. Update is truly partial, so resolve the
  // resulting category/beneficiary against `before` for any field the caller
  // didn't touch.
  const resultCategory: string =
    "category" in safeUpdate ? (safeUpdate as { category?: string }).category! : before.category;
  const isEducationSavings = resultCategory === "education_savings";
  if (isEducationSavings) {
    const resultBeneficiaryFamilyMemberId =
      "beneficiaryFamilyMemberId" in safeUpdate
        ? (safeUpdate as { beneficiaryFamilyMemberId?: string | null }).beneficiaryFamilyMemberId
        : before.beneficiaryFamilyMemberId;
    const resultBeneficiaryName =
      "beneficiaryName" in safeUpdate
        ? (safeUpdate as { beneficiaryName?: string | null }).beneficiaryName
        : before.beneficiaryName;
    if (!resultBeneficiaryFamilyMemberId && !resultBeneficiaryName?.trim()) {
      return writeError(400, "A 529 requires a designated beneficiary (family member or name).");
    }
  }

  // ── isDefaultChecking system-managed guards (port ~81-114) ────────────────
  if (before.isDefaultChecking) {
    if ("category" in safeUpdate && safeUpdate.category !== before.category) {
      return writeError(400, "This is a system-managed cash account — its category can't be changed.");
    }
    if ("subType" in safeUpdate && safeUpdate.subType !== before.subType) {
      return writeError(400, "This is a system-managed cash account — its account type can't be changed.");
    }
    if ("parentAccountId" in body && body.parentAccountId !== before.parentAccountId) {
      return writeError(400, "A system-managed cash account's parent can't be changed.");
    }
    if (Array.isArray(body.owners)) {
      return writeError(400, "This is a system-managed cash account — its ownership can't be changed.");
    }
  }

  // ── owners[] validation (port ~116-147) ───────────────────────────────────
  // When parentAccountId is being set non-null, the account becomes a child of a
  // business account. Children have no per-row owners — skip validation; the
  // transaction wipes accountOwners atomically.
  const isReparentingToParent = body.parentAccountId != null;
  let validatedOwners: ValidatedOwner[] | undefined;

  if (!isReparentingToParent && !isEducationSavings && Array.isArray(body.owners)) {
    const shapeResult = validateOwnersShape(body.owners);
    if ("error" in shapeResult) return writeError(400, shapeResult.error);

    // Resolve subType: incoming value if provided, else the existing row's value.
    const resolvedSubType =
      "subType" in safeUpdate ? (safeUpdate as { subType?: string }).subType : before.subType;

    const rulesError = validateAccountOwnershipRules(
      shapeResult.owners,
      resolvedSubType,
      before.isDefaultChecking,
    );
    if (rulesError) return writeError(400, rulesError.error);
    const tenantError = await validateOwnersTenant(shapeResult.owners, clientId);
    if (tenantError) return writeError(400, tenantError.error);
    validatedOwners = shapeResult.owners;
  }
  // ── end owners[] validation ───────────────────────────────────────────────

  // Strip owners from the spread — owners live in account_owners, not accounts.
  const { owners: _stripOwners, ...accountUpdate } = safeUpdate;
  void _stripOwners;

  let updated: AccountRow;
  await db.transaction(async (tx) => {
    const [result] = await tx
      .update(accounts)
      .set({
        ...(accountUpdate as Partial<AccountRow>),
        updatedAt: new Date(),
      })
      .where(and(eq(accounts.id, accountId), eq(accounts.clientId, clientId)))
      .returning();
    updated = result;

    if (isReparentingToParent || isEducationSavings) {
      // Child-of-business and 529/education_savings accounts carry no per-row
      // owners — clear atomically (empty ownersToWrite naturally wipes any
      // legacy rows, including on a category switch INTO education_savings).
      await tx.delete(accountOwners).where(eq(accountOwners.accountId, accountId));
    } else if (validatedOwners) {
      await tx.delete(accountOwners).where(eq(accountOwners.accountId, accountId));
      for (const o of validatedOwners) {
        await tx.insert(accountOwners).values({
          accountId,
          familyMemberId: o.kind === "family_member" ? o.familyMemberId : null,
          entityId: o.kind === "entity" ? o.entityId : null,
          percent: o.percent.toString(),
        });
      }
    }
  });

  if (!updated!) return writeError(404, "Account not found");

  await recordUpdate({
    action: "account.update",
    resourceType: "account",
    resourceId: accountId,
    clientId,
    firmId,
    actorId,
    before: await toAccountSnapshot(before),
    after: await toAccountSnapshot(updated!),
    fieldLabels: ACCOUNT_FIELD_LABELS,
    extraMetadata: crossFirmMeta,
  });

  // Holdings-tab opt-in toggle: when an account is (re)enabled to derive from its
  // holdings, immediately roll them up into its asset mix. AFTER the tx + audit,
  // matching the route (PUT ~198). CREATE never syncs.
  if (accountUpdate.deriveFromHoldings === true) {
    await syncAccountFromHoldings(accountId);
  }

  // The route returns the pre-sync `updated` row — match it exactly.
  return { ok: true, data: updated!, resourceId: accountId };
}

export async function deleteAccountForClient(args: {
  clientId: string;
  firmId: string;
  actorId: string;
  accountId: string;
  crossFirmMeta?: Record<string, unknown>;
}): Promise<EntityWriteResult<{ id: string }>> {
  const { clientId, firmId, actorId, accountId, crossFirmMeta } = args;

  const a = await verifyClientAccess(clientId);
  if (!a.ok || a.firmId !== firmId) {
    return writeError(404, "Client not found");
  }

  // Protect the default household cash account — it's required by the projection
  // engine. ORDER MATTERS (mirror the route): the isDefaultChecking 400 fires
  // BEFORE the not-found 404 (DELETE ~324-333).
  const [target] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.clientId, clientId)));

  if (target?.isDefaultChecking) {
    return writeError(400, "This is a system-managed cash account and can't be deleted.");
  }
  if (!target) return writeError(404, "Account not found");

  const snapshot = await toAccountSnapshot(target);

  await db.transaction(async (tx) => {
    await tx
      .delete(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.clientId, clientId)));
    await pruneOrphanScenarioChanges(tx, accountId);
  });

  await recordDelete({
    action: "account.delete",
    resourceType: "account",
    resourceId: accountId,
    clientId,
    firmId,
    actorId,
    snapshot,
    extraMetadata: crossFirmMeta,
  });

  return { ok: true, data: { id: accountId }, resourceId: accountId };
}

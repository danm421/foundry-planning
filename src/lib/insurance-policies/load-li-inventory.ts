// src/lib/insurance-policies/load-li-inventory.ts
import { db } from "@/db";
import {
  accounts,
  accountOwners,
  lifeInsurancePolicies,
  beneficiaryDesignations,
  familyMembers,
  externalBeneficiaries,
  entities,
} from "@/db/schema";
import { and, eq, inArray, asc } from "drizzle-orm";

// ── Public shapes ─────────────────────────────────────────────────────────────
export interface LiBeneficiaryRow {
  tier: "primary" | "contingent";
  name: string;
  percentage: number;
}
export interface LiPolicyRow {
  accountId: string;
  name: string;
  policyType: "term" | "whole" | "universal" | "variable";
  ownerLabel: string;
  insuredLabel: string;
  insuredPerson: "client" | "spouse" | "joint";
  deathBenefit: number;
  cashValue: number;
  premiumAmount: number;
  termExpiryYear: number | null;
  carrier: string | null;
  beneficiaries: LiBeneficiaryRow[];
}
export interface LifeInsuranceInventory {
  policies: LiPolicyRow[];
}

// ── Raw (pre-shape) input — what the DB layer assembles ──────────────────────
export interface RawLiInventory {
  clientName: string;
  spouseName: string | null;
  accounts: Array<{
    id: string;
    name: string;
    subType: string | null;
    insuredPerson: "client" | "spouse" | "joint";
    value: number;
  }>;
  policies: Record<
    string,
    {
      faceValue: number;
      premiumAmount: number;
      policyType: "term" | "whole" | "universal" | "variable";
      termIssueYear: number | null;
      termLengthYears: number | null;
      carrier: string | null;
    }
  >;
  owners: Record<string, "client" | "spouse" | "joint">;
  beneficiaries: Record<
    string,
    Array<{
      tier: "primary" | "contingent";
      percentage: number;
      familyMemberId: string | null;
      externalBeneficiaryId: string | null;
      entityIdRef: string | null;
      householdRole: "client" | "spouse" | null;
    }>
  >;
  familyMemberNames: Record<string, string>;
  externalNames: Record<string, string>;
  entityNames: Record<string, string>;
}

function personLabel(
  person: "client" | "spouse" | "joint",
  clientName: string,
  spouseName: string | null,
): string {
  if (person === "client") return clientName;
  if (person === "spouse") return spouseName ?? "Spouse";
  return "Joint";
}

// ── Pure shaper (unit-tested) ─────────────────────────────────────────────────
export function shapeLiInventory(raw: RawLiInventory): LifeInsuranceInventory {
  const policies: LiPolicyRow[] = raw.accounts.map((acct) => {
    const detail = raw.policies[acct.id];
    const owner = raw.owners[acct.id] ?? "client";
    const termExpiryYear =
      detail?.policyType === "term" &&
      detail.termIssueYear != null &&
      detail.termLengthYears != null
        ? detail.termIssueYear + detail.termLengthYears
        : null;

    const beneficiaries: LiBeneficiaryRow[] = (raw.beneficiaries[acct.id] ?? []).map(
      (b) => {
        let name = "—";
        if (b.householdRole) name = personLabel(b.householdRole, raw.clientName, raw.spouseName);
        else if (b.familyMemberId) name = raw.familyMemberNames[b.familyMemberId] ?? "—";
        else if (b.externalBeneficiaryId) name = raw.externalNames[b.externalBeneficiaryId] ?? "—";
        else if (b.entityIdRef) name = raw.entityNames[b.entityIdRef] ?? "—";
        return { tier: b.tier, name, percentage: b.percentage };
      },
    );

    return {
      accountId: acct.id,
      name: acct.name,
      policyType: detail?.policyType ?? "term",
      ownerLabel: personLabel(owner, raw.clientName, raw.spouseName),
      insuredLabel: personLabel(acct.insuredPerson, raw.clientName, raw.spouseName),
      insuredPerson: acct.insuredPerson,
      deathBenefit: detail?.faceValue ?? 0,
      cashValue: acct.value,
      premiumAmount: detail?.premiumAmount ?? 0,
      termExpiryYear,
      carrier: detail?.carrier ?? null,
      beneficiaries,
    };
  });

  return { policies };
}

// ── Owner resolution helper ───────────────────────────────────────────────────
/**
 * Resolves "client" | "spouse" | "joint" from accountOwners rows by matching
 * familyMember IDs against the household principals. Entity-owned or
 * external-beneficiary-owned policies default to "client".
 */
function resolveOwner(
  ownerRows: Array<{ familyMemberId: string | null }>,
  clientFmId: string | null,
  spouseFmId: string | null,
): "client" | "spouse" | "joint" {
  const fmIds = ownerRows
    .map((r) => r.familyMemberId)
    .filter((id): id is string => id != null);

  const hasClient = clientFmId != null && fmIds.includes(clientFmId);
  const hasSpouse = spouseFmId != null && fmIds.includes(spouseFmId);

  if (hasClient && hasSpouse) return "joint";
  if (hasSpouse) return "spouse";
  return "client"; // default: client-owned (or entity/external owned)
}

// ── DB loader (thin wrapper; assembles RawLiInventory, then shapes) ───────────
export async function loadLifeInsuranceInventory(
  clientId: string,
  _firmId: string,
  clientName: string,
  spouseName: string | null,
): Promise<LifeInsuranceInventory> {
  // Load life-insurance accounts and the household family members in parallel.
  const [acctRows, fmRows] = await Promise.all([
    db
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.clientId, clientId),
          eq(accounts.category, "life_insurance"),
        ),
      )
      .orderBy(asc(accounts.name)),
    db
      .select()
      .from(familyMembers)
      .where(eq(familyMembers.clientId, clientId)),
  ]);

  const ids = acctRows.map((a) => a.id);
  if (ids.length === 0) return { policies: [] };

  // Identify client & spouse principal family member IDs for owner resolution.
  const clientFm = fmRows.find((f) => f.role === "client") ?? null;
  const spouseFm = fmRows.find((f) => f.role === "spouse") ?? null;
  const clientFmId = clientFm?.id ?? null;
  const spouseFmId = spouseFm?.id ?? null;

  const [policyRows, benRows, acctOwnerRows, extRows, entRows] = await Promise.all([
    db
      .select()
      .from(lifeInsurancePolicies)
      .where(inArray(lifeInsurancePolicies.accountId, ids)),
    db
      .select()
      .from(beneficiaryDesignations)
      .where(
        and(
          eq(beneficiaryDesignations.clientId, clientId),
          eq(beneficiaryDesignations.targetKind, "account"),
          inArray(beneficiaryDesignations.accountId, ids),
        ),
      )
      .orderBy(asc(beneficiaryDesignations.tier), asc(beneficiaryDesignations.sortOrder)),
    db
      .select()
      .from(accountOwners)
      .where(inArray(accountOwners.accountId, ids)),
    db
      .select()
      .from(externalBeneficiaries)
      .where(eq(externalBeneficiaries.clientId, clientId)),
    db
      .select()
      .from(entities)
      .where(eq(entities.clientId, clientId)),
  ]);

  // Build policies map.
  const policies: RawLiInventory["policies"] = {};
  for (const p of policyRows) {
    policies[p.accountId] = {
      faceValue: Number(p.faceValue),
      premiumAmount: Number(p.premiumAmount),
      policyType: p.policyType,
      termIssueYear: p.termIssueYear,
      termLengthYears: p.termLengthYears,
      carrier: p.carrier,
    };
  }

  // Group accountOwners rows by accountId.
  const ownersByAccount = new Map<string, Array<{ familyMemberId: string | null }>>();
  for (const o of acctOwnerRows) {
    const arr = ownersByAccount.get(o.accountId) ?? [];
    arr.push({ familyMemberId: o.familyMemberId ?? null });
    ownersByAccount.set(o.accountId, arr);
  }

  // Resolve owner enum per account.
  const owners: RawLiInventory["owners"] = {};
  for (const a of acctRows) {
    owners[a.id] = resolveOwner(ownersByAccount.get(a.id) ?? [], clientFmId, spouseFmId);
  }

  // Build beneficiaries map.
  const beneficiaries: RawLiInventory["beneficiaries"] = {};
  for (const b of benRows) {
    if (b.tier !== "primary" && b.tier !== "contingent") continue;
    if (!b.accountId) continue;
    const arr = beneficiaries[b.accountId] ?? [];
    arr.push({
      tier: b.tier,
      percentage: Number(b.percentage),
      familyMemberId: b.familyMemberId ?? null,
      externalBeneficiaryId: b.externalBeneficiaryId ?? null,
      entityIdRef: b.entityIdRef ?? null,
      householdRole: (b.householdRole as "client" | "spouse" | null) ?? null,
    });
    beneficiaries[b.accountId] = arr;
  }

  // Build name lookup maps.
  // familyMembers uses firstName + lastName (no single name column).
  const familyMemberNames: Record<string, string> = {};
  for (const f of fmRows) {
    familyMemberNames[f.id] = [f.firstName, f.lastName].filter(Boolean).join(" ").trim();
  }

  const externalNames: Record<string, string> = {};
  for (const e of extRows) externalNames[e.id] = e.name;

  const entityNames: Record<string, string> = {};
  for (const e of entRows) entityNames[e.id] = e.name;

  return shapeLiInventory({
    clientName,
    spouseName,
    accounts: acctRows.map((a) => ({
      id: a.id,
      name: a.name,
      subType: a.subType,
      insuredPerson: (a.insuredPerson as "client" | "spouse" | "joint") ?? "client",
      value: Number(a.value),
    })),
    policies,
    owners,
    beneficiaries,
    familyMemberNames,
    externalNames,
    entityNames,
  });
}

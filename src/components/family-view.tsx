"use client";

import { useState, useEffect, useCallback } from "react";
import { useScenarioWriter } from "@/hooks/use-scenario-writer";
import { useClientAccess } from "./client-access-provider";
import ConfirmDeleteDialog from "./confirm-delete-dialog";
import AddClientDialog from "./add-client-dialog";
import EntityDialog from "./entity-dialog";
import RevocableTrustTagDialog from "./revocable-trust-tag-dialog";
import BeneficiarySummary from "./beneficiary-summary";
import GiftDialog from "@/components/gift-dialog";
import AddAccountDialog from "./add-account-dialog";
import FamilyMemberDialog from "./family-member-dialog";
import type { AccountFormInitial } from "./forms/add-account-form";
import type { EntityFlowMode } from "@/engine/types";
import type { ClientFormInitial } from "./forms/add-client-form";
import type { ClientWithContacts } from "@/lib/clients/get-client-with-contacts";
import { type TrustSubType } from "@/lib/entities/trust";
import type { AssetsTabAccount, AssetsTabLiability, AssetsTabIncome, AssetsTabExpense, AssetsTabFamilyMember, AssetsTabBusiness } from "./forms/assets-tab";
import type { AccountOwner } from "@/engine/ownership";

// ── Types ─────────────────────────────────────────────────────────────────────

type Relationship =
  | "child"
  | "stepchild"
  | "grandchild"
  | "great_grandchild"
  | "parent"
  | "grandparent"
  | "sibling"
  | "sibling_in_law"
  | "child_in_law"
  | "niece_nephew"
  | "aunt_uncle"
  | "cousin"
  | "grand_aunt_uncle"
  | "other";
export type EntityType = "trust" | "llc" | "s_corp" | "c_corp" | "partnership" | "foundation" | "other";

export interface FamilyMember {
  id: string;
  firstName: string;
  lastName: string | null;
  relationship: Relationship;
  /** Household role. Present on rows loaded from `family_members.role`. */
  role?: "client" | "spouse" | "child" | "other";
  dateOfBirth: string | null;
  notes: string | null;
  domesticPartner?: boolean;
  inheritanceClassOverride?: Partial<Record<"PA" | "NJ" | "KY" | "NE" | "MD", "A" | "B" | "C" | "D">>;
}

export interface NamePctRow {
  name: string;
  pct: number;
}

export interface Entity {
  id: string;
  name: string;
  entityType: EntityType;
  notes: string | null;
  includeInPortfolio: boolean;
  isGrantor: boolean;
  grantorStatusEndYear?: number | null;
  value: string;
  basis: string;
  /** Multi-owner allocation for business entities. Empty for trusts. */
  owners: AccountOwner[];
  owner: "client" | "spouse" | "joint" | null;
  grantor: "client" | "spouse" | null;
  beneficiaries: NamePctRow[] | null;
  trustSubType: TrustSubType | null;
  isIrrevocable: boolean | null;
  trustee: string | null;
  trustEnds: "client_death" | "spouse_death" | "survivorship" | null;
  // Distribution policy (irrevocable trusts only)
  distributionMode: "fixed" | "pct_liquid" | "pct_income" | null;
  distributionAmount: number | null;
  distributionPercent: number | null;
  taxTreatment?: "qbi" | "ordinary" | "non_taxable";
  distributionPolicyPercent?: number | null;
  flowMode?: EntityFlowMode;
  /** Annual compound growth rate for the standalone equity value (`value`).
   *  Null = 0% (today's behavior). Business-entity only. */
  valueGrowthRate?: number | null;
}

export type Gift = {
  id: string;
  year: number;
  amount: number | null; // null for in-kind asset gifts
  grantor: "client" | "spouse" | "joint";
  recipientEntityId: string | null;
  recipientFamilyMemberId: string | null;
  recipientExternalBeneficiaryId: string | null;
  accountId: string | null; // set for in-kind asset gifts
  percent: number | null; // fraction 0..1, set for in-kind asset gifts
  useCrummeyPowers: boolean;
  notes: string | null;
};

export type GiftSeriesLite = {
  id: string;
  grantor: "client" | "spouse" | "joint";
  recipientEntityId: string;
  startYear: number;
  endYear: number;
  annualAmount: number;
  amountMode: "fixed" | "annual_exclusion";
  inflationAdjust: boolean;
  useCrummeyPowers: boolean;
};

export type ExternalBeneficiary = {
  id: string;
  name: string;
  kind: "charity" | "individual";
  notes: string | null;
};

export type AccountLite = {
  id: string;
  name: string;
  category: string;
  ownerFamilyMemberId: string | null;
  ownerEntityId: string | null;
};

export type RevocableTrustTag = {
  id: string;
  name: string;
  accountIds: string[];
};

export type Tier = "primary" | "contingent";

export type Designation = {
  id: string;
  targetKind: "account" | "trust";
  accountId: string | null;
  entityId: string | null;
  tier: "primary" | "contingent" | "income" | "remainder";
  familyMemberId: string | null;
  externalBeneficiaryId: string | null;
  entityIdRef: string | null;
  householdRole: "client" | "spouse" | null;
  percentage: number;
  sortOrder: number;
  distributionForm?: "in_trust" | "outright" | null;
};

export interface PrimaryInfo {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  retirementAge: number;
  retirementMonth?: number | null;
  lifeExpectancy: number;
  filingStatus: string;
  spouseName: string | null;
  spouseLastName: string | null;
  spouseDob: string | null;
  spouseRetirementAge: number | null;
  spouseRetirementMonth?: number | null;
  spouseLifeExpectancy: number | null;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function birthYear(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (isNaN(d.getTime())) return null;
  return d.getFullYear();
}

function formatRetirement(
  age: number | null | undefined,
  month: number | null | undefined,
  dob: string | null | undefined,
): string {
  if (age == null) return "—";
  const m = month ?? 1;
  const by = birthYear(dob);
  const year = by != null ? by + age : null;
  const monthLabel = MONTH_NAMES[m - 1];
  if (year == null) return m === 1 ? String(age) : `${age} (${monthLabel})`;
  return `${age} (${monthLabel} ${year})`;
}

function formatLifeExpectancy(
  age: number | null | undefined,
  dob: string | null | undefined,
): string {
  if (age == null) return "—";
  const by = birthYear(dob);
  if (by == null) return String(age);
  return `${age} (${by + age})`;
}

interface FamilyViewProps {
  clientId: string;
  primary: PrimaryInfo;
  initialMembers: FamilyMember[];
  initialEntities: Entity[];
  initialExternalBeneficiaries: ExternalBeneficiary[];
  initialAccounts: AccountLite[];
  initialDesignations: Designation[];
  initialGifts: Gift[];
  initialGiftSeries: GiftSeriesLite[];
  annualExclusionByYear: Record<number, number>;
  scenarioId: string;
  /** Optional: full asset data for the trust Assets tab */
  initialFullAccounts?: AssetsTabAccount[];
  initialFullLiabilities?: AssetsTabLiability[];
  initialFullIncomes?: AssetsTabIncome[];
  initialFullExpenses?: AssetsTabExpense[];
  /** Business entities (with polymorphic owners) for the trust-Assets picker. */
  initialFullBusinesses?: AssetsTabBusiness[];
  initialAssetFamilyMembers?: AssetsTabFamilyMember[];
  /** Contact info from CRM contact rows; pre-populates the edit dialog. */
  contacts: ClientWithContacts | null;
  embed?: "page" | "wizard";
  /** When `embed === "wizard"`, only render this section. */
  section?: "household" | "family" | "entities" | "externals";
}

const RELATIONSHIP_LABELS: Record<Relationship, string> = {
  child: "Child",
  stepchild: "Stepchild",
  grandchild: "Grandchild",
  great_grandchild: "Great-grandchild",
  parent: "Parent",
  grandparent: "Grandparent",
  sibling: "Sibling",
  sibling_in_law: "Sibling-in-law",
  child_in_law: "Son/Daughter-in-law",
  niece_nephew: "Niece/Nephew",
  aunt_uncle: "Aunt/Uncle",
  cousin: "Cousin",
  grand_aunt_uncle: "Grand-aunt/uncle",
  other: "Other",
};

export const ENTITY_LABELS: Record<EntityType, string> = {
  trust: "Trust",
  llc: "LLC",
  s_corp: "S Corp",
  c_corp: "C Corp",
  partnership: "Partnership",
  foundation: "Foundation",
  other: "Other",
};

function computeAge(dob: string | null): string {
  if (!dob) return "—";
  const d = new Date(dob);
  if (isNaN(d.getTime())) return "—";
  const diff = Date.now() - d.getTime();
  const years = diff / (365.25 * 24 * 60 * 60 * 1000);
  if (years < 1) return "< 1";
  return String(Math.floor(years));
}

/**
 * Hydrate an `AccountLite` into the shape `AddAccountForm` expects. Used by
 * the Beneficiary Summary's Edit deep-link, which always opens the dialog on
 * the Beneficiaries tab — that tab only reads `initial.id`, so the remaining
 * fields get safe zero-values. If the user then switches to other tabs, they
 * will see empty/default values; the canonical edit path from Balance Sheet
 * still provides the full `AccountFormInitial` with accurate values.
 */
function accountLiteToFormInitial(a: AccountLite): AccountFormInitial {
  const category = (a.category as AccountFormInitial["category"]) ?? "taxable";
  return {
    id: a.id,
    name: a.name,
    category,
    subType: "other",
    owner: "client",
    value: "0",
    basis: "0",
    growthRate: null,
    ownerEntityId: a.ownerEntityId ?? null,
  };
}

export function TrashIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
        clipRule="evenodd"
      />
    </svg>
  );
}

// ── Main Family View ──────────────────────────────────────────────────────────

export default function FamilyView({
  clientId,
  primary,
  initialMembers,
  initialEntities,
  initialExternalBeneficiaries,
  initialAccounts,
  initialDesignations,
  initialGifts,
  initialGiftSeries,
  annualExclusionByYear,
  scenarioId,
  initialFullAccounts,
  initialFullLiabilities,
  initialFullIncomes,
  initialFullExpenses,
  initialFullBusinesses,
  initialAssetFamilyMembers,
  contacts,
  embed = "page",
  section,
}: FamilyViewProps) {
  const writer = useScenarioWriter(clientId);
  const { permission } = useClientAccess();
  const canEdit = permission === "edit";
  const [members, setMembers] = useState<FamilyMember[]>(initialMembers);
  const [entities, setEntities] = useState<Entity[]>(initialEntities);
  const [externals, setExternals] = useState<ExternalBeneficiary[]>(initialExternalBeneficiaries);
  const [accounts] = useState<AccountLite[]>(initialAccounts);
  const [designations] = useState<Designation[]>(initialDesignations);
  const [giftsState, setGiftsState] = useState<Gift[]>(initialGifts);
  const [giftSeriesState, setGiftSeriesState] = useState<GiftSeriesLite[]>(initialGiftSeries);

  const [memberDialogOpen, setMemberDialogOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<FamilyMember | undefined>();
  const [deletingMember, setDeletingMember] = useState<FamilyMember | null>(null);
  const [membersEdit, setMembersEdit] = useState(false);

  const [entityDialogOpen, setEntityDialogOpen] = useState(false);
  const [editingEntity, setEditingEntity] = useState<Entity | undefined>();
  const [deletingEntity, setDeletingEntity] = useState<Entity | null>(null);
  const [entitiesEdit, setEntitiesEdit] = useState(false);

  const handleEntitySaved = (e: Entity, mode: "create" | "edit") => {
    if (mode === "create") setEntities((prev) => [...prev, e]);
    else setEntities((prev) => prev.map((x) => (x.id === e.id ? e : x)));
  };

  // All entity types (irrevocable trusts, LLCs, etc.) use the full EntityDialog.
  // Revocable trusts are now a separate tag model — they no longer route here.
  const openEntityEditor = (e: Entity) => {
    setEditingEntity(e);
    setEntityDialogOpen(true);
  };

  // ── Revocable Trusts (tag model) ──────────────────────────────────────────

  const [revocableTrusts, setRevocableTrusts] = useState<RevocableTrustTag[]>([]);
  const [revocableTagDialogOpen, setRevocableTagDialogOpen] = useState(false);
  const [editingRevocableTrust, setEditingRevocableTrust] = useState<RevocableTrustTag | undefined>();

  const fetchRevocableTrusts = useCallback(async () => {
    try {
      const res = await fetch(`/api/clients/${clientId}/revocable-trusts`);
      if (res.ok) {
        const data = (await res.json()) as RevocableTrustTag[];
        setRevocableTrusts(data);
      }
    } catch {
      // silently ignore fetch errors on mount
    }
  }, [clientId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount fetch; setRevocableTrusts only runs after the awaited fetch resolves (no synchronous cascade). Re-fetched explicitly via the dialog's onSaved.
    void fetchRevocableTrusts();
  }, [fetchRevocableTrusts]);

  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [accountDialogEditing, setAccountDialogEditing] = useState<AccountFormInitial | undefined>(undefined);
  const [accountDialogInitialTab, setAccountDialogInitialTab] = useState<"details" | "beneficiaries">("details");
  const [accountDialogLockTab, setAccountDialogLockTab] = useState(false);

  const primaryAge = computeAge(primary.dateOfBirth);
  const spouseAge = primary.spouseDob ? computeAge(primary.spouseDob) : null;

  const [editProfileOpen, setEditProfileOpen] = useState(false);

  const profileInitial: ClientFormInitial = {
    id: clientId,
    firstName: primary.firstName,
    lastName: primary.lastName,
    dateOfBirth: primary.dateOfBirth,
    retirementAge: primary.retirementAge,
    retirementMonth: primary.retirementMonth ?? 1,
    lifeExpectancy: primary.lifeExpectancy,
    filingStatus: primary.filingStatus,
    spouseName: primary.spouseName,
    spouseLastName: primary.spouseLastName,
    spouseDob: primary.spouseDob,
    spouseRetirementAge: primary.spouseRetirementAge,
    spouseRetirementMonth: primary.spouseRetirementMonth ?? null,
    spouseLifeExpectancy: primary.spouseLifeExpectancy,
    email:              contacts?.email              ?? null,
    phone:              contacts?.phone              ?? null,
    mobile:             contacts?.mobile             ?? null,
    addressLine1:       contacts?.addressLine1       ?? null,
    addressLine2:       contacts?.addressLine2       ?? null,
    city:               contacts?.city               ?? null,
    state:              contacts?.state              ?? null,
    postalCode:         contacts?.postalCode         ?? null,
    country:            contacts?.country            ?? null,
    spouseEmail:        contacts?.spouseEmail        ?? null,
    spousePhone:        contacts?.spousePhone        ?? null,
    spouseMobile:       contacts?.spouseMobile       ?? null,
    spouseAddressLine1: contacts?.spouseAddressLine1 ?? null,
    spouseAddressLine2: contacts?.spouseAddressLine2 ?? null,
    spouseCity:         contacts?.spouseCity         ?? null,
    spouseState:        contacts?.spouseState        ?? null,
    spousePostalCode:   contacts?.spousePostalCode   ?? null,
    spouseCountry:      contacts?.spouseCountry      ?? null,
  };

  // Group members by relationship
  const byRel: Record<Relationship, FamilyMember[]> = {
    child: [],
    stepchild: [],
    grandchild: [],
    great_grandchild: [],
    parent: [],
    grandparent: [],
    sibling: [],
    sibling_in_law: [],
    child_in_law: [],
    niece_nephew: [],
    aunt_uncle: [],
    cousin: [],
    grand_aunt_uncle: [],
    other: [],
  };
  for (const m of members) byRel[m.relationship].push(m);

  return (
    <div className="space-y-8">
      {/* Primary household */}
      {(embed !== "wizard" || section === "household") && (
        <section>
          <header className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-100">Household</h2>
              <p className="text-xs text-gray-400">Client and spouse. Edit from the Clients list.</p>
            </div>
            {canEdit && (
              <button
                onClick={() => setEditProfileOpen(true)}
                className="rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-700"
              >
                Edit profile
              </button>
            )}
          </header>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <PersonCard
              name={`${primary.firstName} ${primary.lastName}`}
              badge="Client"
              fields={[
                ["Date of Birth", primary.dateOfBirth ? `${new Date(primary.dateOfBirth).toLocaleDateString()} (age ${primaryAge})` : "—"],
                ["Retirement", formatRetirement(primary.retirementAge, primary.retirementMonth, primary.dateOfBirth)],
                ["Life Expectancy", formatLifeExpectancy(primary.lifeExpectancy, primary.dateOfBirth)],
              ]}
            />
            {primary.spouseName ? (
              <PersonCard
                name={`${primary.spouseName} ${primary.spouseLastName ?? primary.lastName}`.trim()}
                badge="Spouse"
                fields={[
                  ["Date of Birth", primary.spouseDob ? `${new Date(primary.spouseDob).toLocaleDateString()} (age ${spouseAge})` : "—"],
                  ["Retirement", formatRetirement(primary.spouseRetirementAge, primary.spouseRetirementMonth, primary.spouseDob)],
                  ["Life Expectancy", formatLifeExpectancy(primary.spouseLifeExpectancy, primary.spouseDob)],
                ]}
              />
            ) : (
              <div className="flex items-center justify-center rounded-lg border border-dashed border-gray-800 bg-gray-900/40 p-6 text-sm text-gray-400">
                No spouse on file
              </div>
            )}
          </div>
        </section>
      )}

      <AddClientDialog
        open={editProfileOpen}
        onOpenChange={setEditProfileOpen}
        editing={profileInitial}
      />

      {/* Family members */}
      {(embed !== "wizard" || section === "family") && (
      <section>
        <header className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-100">Family Members</h2>
            <p className="text-xs text-gray-400">Children, grandchildren, parents, and others.</p>
          </div>
          <div className="flex items-center gap-2">
            {canEdit && members.length > 0 && (
              <button
                onClick={() => setMembersEdit((v) => !v)}
                className={`rounded-md border px-3 py-1 text-xs font-medium ${
                  membersEdit
                    ? "border-accent bg-accent/15 text-accent-ink"
                    : "border-gray-600 bg-gray-900 text-gray-300 hover:bg-gray-800"
                }`}
              >
                {membersEdit ? "Done" : "Edit"}
              </button>
            )}
            {canEdit && (
              <button
                onClick={() => {
                  setEditingMember(undefined);
                  setMemberDialogOpen(true);
                }}
                className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-on hover:bg-accent-ink"
              >
                + Add
              </button>
            )}
          </div>
        </header>

        {members.length === 0 ? (
          <EmptyState label="No family members added yet." />
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-800 bg-gray-900/50">
            <table className="min-w-full divide-y divide-gray-800">
              <thead className="bg-gray-800/60">
                <tr className="text-left text-xs font-medium uppercase tracking-wider text-gray-300">
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2">Relationship</th>
                  <th className="px-4 py-2">Age</th>
                  <th className="px-4 py-2">Notes</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {(["child", "grandchild", "parent", "sibling", "other"] as Relationship[]).flatMap((rel) =>
                  byRel[rel].map((m) => (
                    <tr
                      key={m.id}
                      className={canEdit ? "cursor-pointer hover:bg-gray-800/50" : ""}
                      onClick={canEdit ? () => {
                        if (membersEdit) return;
                        setEditingMember(m);
                        setMemberDialogOpen(true);
                      } : undefined}
                    >
                      <td className="px-4 py-2 text-sm text-gray-100">
                        {m.firstName} {m.lastName ?? ""}
                      </td>
                      <td className="px-4 py-2 text-sm text-gray-300">{RELATIONSHIP_LABELS[m.relationship]}</td>
                      <td className="px-4 py-2 text-sm text-gray-300">{computeAge(m.dateOfBirth)}</td>
                      <td className="px-4 py-2 text-sm text-gray-400 truncate max-w-[260px]">{m.notes ?? ""}</td>
                      <td className="px-4 py-2 text-right">
                        {membersEdit && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeletingMember(m);
                            }}
                            className="text-white hover:text-white"
                            aria-label={`Delete ${m.firstName}`}
                          >
                            <TrashIcon />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
      )}

      {/* Trusts */}
      {(embed !== "wizard" || section === "entities") && (
      <section>
        <header className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-100">Trusts</h2>
            <p className="text-xs text-gray-400">
              Trusts that can own accounts, incomes, or expenses.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canEdit && entities.length > 0 && (
              <button
                onClick={() => setEntitiesEdit((v) => !v)}
                className={`rounded-md border px-3 py-1 text-xs font-medium ${
                  entitiesEdit
                    ? "border-accent bg-accent/15 text-accent-ink"
                    : "border-gray-600 bg-gray-900 text-gray-300 hover:bg-gray-800"
                }`}
              >
                {entitiesEdit ? "Done" : "Edit"}
              </button>
            )}
            {canEdit && (
              <button
                onClick={() => {
                  setEditingEntity(undefined);
                  setEntityDialogOpen(true);
                }}
                className="inline-flex items-center rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-on hover:bg-accent-ink"
              >
                + Add Trust
              </button>
            )}
          </div>
        </header>

        {entities.length === 0 ? (
          <EmptyState label="No trusts yet. Add a trust to own assets separately." />
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-800 bg-gray-900/50">
            <table className="min-w-full divide-y divide-gray-800">
              <thead className="bg-gray-800/60">
                <tr className="text-left text-xs font-medium uppercase tracking-wider text-gray-300">
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2">Type</th>
                  <th className="px-4 py-2">Notes</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {entities.map((e) => (
                  <tr
                    key={e.id}
                    className={canEdit ? "cursor-pointer hover:bg-gray-800/50" : ""}
                    onClick={canEdit ? () => {
                      if (entitiesEdit) return;
                      openEntityEditor(e);
                    } : undefined}
                  >
                    <td className="px-4 py-2 text-sm text-gray-100">{e.name}</td>
                    <td className="px-4 py-2 text-sm text-gray-300">{ENTITY_LABELS[e.entityType]}</td>
                    <td className="px-4 py-2 text-sm text-gray-400 truncate max-w-[260px]">{e.notes ?? ""}</td>
                    <td className="px-4 py-2 text-right">
                      {entitiesEdit && (
                        <button
                          onClick={(ev) => {
                            ev.stopPropagation();
                            setDeletingEntity(e);
                          }}
                          className="text-white hover:text-white"
                          aria-label={`Delete ${e.name}`}
                        >
                          <TrashIcon />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      )}

      {/* Revocable Trusts — tag model, separate from entity cards above */}
      {(embed !== "wizard" || section === "entities") && (
      <section>
        <header className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-100">Revocable Trusts</h2>
            <p className="text-xs text-gray-400">
              Living trusts that tag accounts for probate-avoidance tracking.
            </p>
          </div>
          {canEdit && (
            <button
              onClick={() => {
                setEditingRevocableTrust(undefined);
                setRevocableTagDialogOpen(true);
              }}
              className="inline-flex items-center rounded-md border border-accent px-3 py-1.5 text-xs font-medium text-accent-ink hover:bg-accent/10"
            >
              + Add Revocable Trust
            </button>
          )}
        </header>

        {revocableTrusts.length === 0 ? (
          <EmptyState label="No revocable trusts added yet." />
        ) : (
          <div className="overflow-hidden rounded-lg border border-hair bg-card/50">
            <table className="min-w-full divide-y divide-hair">
              <thead className="bg-card-2/60">
                <tr className="text-left text-xs font-medium uppercase tracking-wider text-ink-3">
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2">Accounts</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-hair">
                {revocableTrusts.map((t) => (
                  <tr
                    key={t.id}
                    className={canEdit ? "cursor-pointer hover:bg-card-2/50" : ""}
                    onClick={canEdit ? () => {
                      setEditingRevocableTrust(t);
                      setRevocableTagDialogOpen(true);
                    } : undefined}
                  >
                    <td className="px-4 py-2 text-sm text-ink">{t.name}</td>
                    <td className="px-4 py-2 text-sm text-ink-3 tabular-nums">
                      {t.accountIds.length} {t.accountIds.length === 1 ? "asset" : "assets"}
                    </td>
                    <td className="px-4 py-2 text-right text-xs text-ink-4">Edit →</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      )}

      {/* External Beneficiaries */}
      {(embed !== "wizard" || section === "externals") && (
        <ExternalBeneficiariesSection
          clientId={clientId}
          externals={externals}
          setExternals={setExternals}
          canEdit={canEdit}
        />
      )}

      {embed !== "wizard" && (
      <GiftsSection
        clientId={clientId}
        members={members}
        externals={externals}
        entities={entities}
        accounts={accounts}
        gifts={giftsState}
        series={giftSeriesState}
        annualExclusionByYear={annualExclusionByYear}
        scenarioId={scenarioId}
        hasSpouse={primary.spouseName != null}
        onChangeGifts={setGiftsState}
        onChangeSeries={setGiftSeriesState}
        canEdit={canEdit}
      />
      )}

      {embed !== "wizard" && (
      <BeneficiarySummary
        accounts={accounts}
        entities={entities}
        designations={designations}
        members={members}
        externals={externals}
        clientName={`${primary.firstName} ${primary.lastName}`.trim()}
        spouseName={
          primary.spouseName
            ? `${primary.spouseName} ${primary.spouseLastName ?? primary.lastName}`.trim()
            : null
        }
        onEditAccount={canEdit ? (accountId) => {
          const acct = accounts.find((a) => a.id === accountId);
          if (!acct) return;
          setAccountDialogEditing(accountLiteToFormInitial(acct));
          setAccountDialogInitialTab("beneficiaries");
          setAccountDialogLockTab(true);
          setAccountDialogOpen(true);
        } : undefined}
        onEditEntity={canEdit ? (entityId) => {
          const ent = entities.find((e) => e.id === entityId);
          if (!ent) return;
          openEntityEditor(ent);
        } : undefined}
      />
      )}

      {memberDialogOpen && (
        <FamilyMemberDialog
          key={editingMember?.id ?? "new"}
          clientId={clientId}
          open={memberDialogOpen}
          onOpenChange={setMemberDialogOpen}
          editing={editingMember}
          onSaved={(m, mode) => {
            if (mode === "create") setMembers((prev) => [...prev, m]);
            else setMembers((prev) => prev.map((x) => (x.id === m.id ? m : x)));
          }}
          onRequestDelete={() => {
            if (editingMember) setDeletingMember(editingMember);
          }}
        />
      )}

      {entityDialogOpen && (
        <EntityDialog
          key={editingEntity?.id ?? "new"}
          clientId={clientId}
          open={entityDialogOpen}
          onOpenChange={setEntityDialogOpen}
          editing={editingEntity}
          household={{
            client: { firstName: primary.firstName },
            spouse: primary.spouseName ? { firstName: primary.spouseName } : null,
          }}
          members={members}
          externals={externals}
          otherEntities={entities
            .filter((e) => e.id !== editingEntity?.id)
            .map((e) => ({ id: e.id, name: e.name }))}
          initialDesignations={designations}
          accounts={initialFullAccounts}
          liabilities={initialFullLiabilities}
          incomes={initialFullIncomes}
          expenses={initialFullExpenses}
          businesses={initialFullBusinesses}
          assetFamilyMembers={initialAssetFamilyMembers}
          primaryClientBirthYear={
            primary.dateOfBirth
              ? new Date(primary.dateOfBirth).getFullYear()
              : undefined
          }
          planEndYear={
            primary.dateOfBirth
              ? new Date(primary.dateOfBirth).getFullYear() + primary.lifeExpectancy
              : undefined
          }
          onSaved={handleEntitySaved}
          onAutoSaved={handleEntitySaved}
          onRequestDelete={() => {
            if (editingEntity) setDeletingEntity(editingEntity);
          }}
        />
      )}

      {revocableTagDialogOpen && (
        <RevocableTrustTagDialog
          key={editingRevocableTrust?.id ?? "new-revocable-tag"}
          clientId={clientId}
          editing={editingRevocableTrust}
          accounts={accounts}
          onSaved={async () => {
            await fetchRevocableTrusts();
            setRevocableTagDialogOpen(false);
          }}
          onClose={() => setRevocableTagDialogOpen(false)}
        />
      )}

      {accountDialogOpen && (
        <AddAccountDialog
          clientId={clientId}
          open={accountDialogOpen}
          onOpenChange={(open) => {
            setAccountDialogOpen(open);
            if (!open) {
              setAccountDialogInitialTab("details");
              setAccountDialogLockTab(false);
            }
          }}
          editing={accountDialogEditing}
          initialTab={accountDialogInitialTab}
          lockTab={accountDialogLockTab}
          familyMembers={[]}
        />
      )}

      <ConfirmDeleteDialog
        open={!!deletingMember}
        title="Delete Family Member"
        message={deletingMember ? `Delete ${deletingMember.firstName}${deletingMember.lastName ? " " + deletingMember.lastName : ""}?` : ""}
        onCancel={() => setDeletingMember(null)}
        onConfirm={async () => {
          if (!deletingMember) return;
          const res = await writer.submit(
            { op: "remove", targetKind: "family_member", targetId: deletingMember.id },
            {
              url: `/api/clients/${clientId}/family-members/${deletingMember.id}`,
              method: "DELETE",
            },
          );
          if (res.ok || res.status === 204) {
            setMembers((prev) => prev.filter((m) => m.id !== deletingMember.id));
            setMemberDialogOpen(false);
            setDeletingMember(null);
          }
        }}
      />

      <ConfirmDeleteDialog
        open={!!deletingEntity}
        title="Delete Trust"
        message={
          deletingEntity
            ? `Delete ${deletingEntity.name}? Any accounts owned by this trust will revert to the primary owner.`
            : ""
        }
        onCancel={() => setDeletingEntity(null)}
        onConfirm={async () => {
          if (!deletingEntity) return;
          const res = await writer.submit(
            { op: "remove", targetKind: "entity", targetId: deletingEntity.id },
            {
              url: `/api/clients/${clientId}/entities/${deletingEntity.id}`,
              method: "DELETE",
            },
          );
          if (res.ok || res.status === 204) {
            setEntities((prev) => prev.filter((e) => e.id !== deletingEntity.id));
            setEntityDialogOpen(false);
            setDeletingEntity(null);
          }
        }}
      />
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PersonCard({ name, badge, fields }: { name: string; badge: string; fields: [string, string][] }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/60 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-100">{name}</h3>
        <span className="rounded bg-gray-800 px-2 py-0.5 text-xs font-medium uppercase tracking-wider text-gray-300">
          {badge}
        </span>
      </div>
      <dl className="mt-3 space-y-1.5 text-sm">
        {fields.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4">
            <dt className="text-gray-400">{k}</dt>
            <dd className="text-gray-200">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function GiftsSection(props: {
  clientId: string;
  members: FamilyMember[];
  externals: ExternalBeneficiary[];
  entities: Entity[];
  accounts: AccountLite[];
  gifts: Gift[];
  series: GiftSeriesLite[];
  annualExclusionByYear: Record<number, number>;
  scenarioId: string;
  hasSpouse: boolean;
  onChangeGifts: (gifts: Gift[]) => void;
  onChangeSeries: (series: GiftSeriesLite[]) => void;
  canEdit: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [editingGift, setEditingGift] = useState<Gift | null>(null);
  const [editingSeries, setEditingSeries] = useState<GiftSeriesLite | null>(null);

  const recipientLabel = (
    ids: { entity?: string | null; family?: string | null; external?: string | null },
  ): string => {
    if (ids.entity) return props.entities.find((e) => e.id === ids.entity)?.name ?? "—";
    if (ids.family) {
      const m = props.members.find((x) => x.id === ids.family);
      return m ? `${m.firstName} ${m.lastName ?? ""}`.trim() : "—";
    }
    if (ids.external) return props.externals.find((x) => x.id === ids.external)?.name ?? "—";
    return "—";
  };

  const accountName = (id: string | null) =>
    id ? props.accounts.find((a) => a.id === id)?.name ?? "asset" : "asset";

  async function deleteGift(id: string) {
    const res = await fetch(`/api/clients/${props.clientId}/gifts/${id}`, { method: "DELETE" });
    if (res.ok) props.onChangeGifts(props.gifts.filter((x) => x.id !== id));
  }
  async function deleteSeries(id: string) {
    const res = await fetch(
      `/api/clients/${props.clientId}/gifts/series/${id}?scenario=${props.scenarioId}`,
      { method: "DELETE" },
    );
    if (res.ok) props.onChangeSeries(props.series.filter((x) => x.id !== id));
  }

  const dialogOpen = adding || editingGift != null || editingSeries != null;

  return (
    <section className="mt-6 rounded-lg border border-gray-700 bg-gray-900 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-300">Gifts</h3>
        {props.canEdit && (
          <button
            type="button"
            onClick={() => { setEditingGift(null); setEditingSeries(null); setAdding(true); }}
            className="rounded bg-accent px-3 py-1 text-sm text-accent-on hover:bg-accent-ink"
          >
            + Add gift
          </button>
        )}
      </div>

      {dialogOpen && (
        <GiftDialog
          clientId={props.clientId}
          scenarioId={props.scenarioId}
          hasSpouse={props.hasSpouse}
          members={props.members}
          externals={props.externals}
          entities={props.entities}
          accounts={props.accounts}
          annualExclusionByYear={props.annualExclusionByYear}
          editingGift={editingGift}
          editingSeries={editingSeries}
          onClose={() => { setAdding(false); setEditingGift(null); setEditingSeries(null); }}
          onSavedGift={(g) => {
            const exists = props.gifts.some((x) => x.id === g.id);
            props.onChangeGifts(exists ? props.gifts.map((x) => (x.id === g.id ? g : x)) : [...props.gifts, g]);
            setAdding(false); setEditingGift(null);
          }}
          onSavedSeries={(s) => {
            const exists = props.series.some((x) => x.id === s.id);
            props.onChangeSeries(exists ? props.series.map((x) => (x.id === s.id ? s : x)) : [...props.series, s]);
            setAdding(false); setEditingSeries(null);
          }}
        />
      )}

      {props.gifts.length === 0 && props.series.length === 0 ? (
        <p className="text-sm text-gray-400">No gifts recorded.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-gray-300">
              <th className="px-2 py-1">When</th>
              <th className="px-2 py-1">Grantor</th>
              <th className="px-2 py-1 text-right">Amount</th>
              <th className="px-2 py-1">Recipient</th>
              <th className="px-2 py-1">Crummey</th>
              <th className="px-2 py-1"></th>
            </tr>
          </thead>
          <tbody>
            {props.gifts.map((g) => (
              <tr key={`gift-${g.id}`} className="border-t border-gray-800">
                <td className="px-2 py-1">{g.year}</td>
                <td className="px-2 py-1 capitalize">{g.grantor === "joint" ? "Both (split)" : g.grantor}</td>
                <td className="px-2 py-1 text-right">
                  {g.amount != null
                    ? `$${g.amount.toLocaleString()}`
                    : `${((g.percent ?? 0) * 100).toFixed(0)}% of ${accountName(g.accountId)}`}
                </td>
                <td className="px-2 py-1">
                  {recipientLabel({ entity: g.recipientEntityId, family: g.recipientFamilyMemberId, external: g.recipientExternalBeneficiaryId })}
                </td>
                <td className="px-2 py-1">{g.useCrummeyPowers ? "✓" : ""}</td>
                <td className="px-2 py-1 text-right">
                  {props.canEdit && (
                    <>
                      <button type="button" onClick={() => { setEditingGift(g); setEditingSeries(null); setAdding(false); }} className="mr-3 text-xs text-accent-ink hover:underline">Edit</button>
                      <button type="button" onClick={() => deleteGift(g.id)} className="text-xs text-red-400 hover:text-red-300">Delete</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {props.series.map((s) => (
              <tr key={`series-${s.id}`} className="border-t border-gray-800">
                <td className="px-2 py-1">{s.startYear}–{s.endYear}/yr</td>
                <td className="px-2 py-1 capitalize">{s.grantor === "joint" ? "Both (split)" : s.grantor}</td>
                <td className="px-2 py-1 text-right">
                  {s.amountMode === "annual_exclusion" ? "Max exclusion" : `$${s.annualAmount.toLocaleString()}/yr`}
                </td>
                <td className="px-2 py-1">{recipientLabel({ entity: s.recipientEntityId })}</td>
                <td className="px-2 py-1">{s.useCrummeyPowers ? "✓" : ""}</td>
                <td className="px-2 py-1 text-right">
                  {props.canEdit && (
                    <>
                      <button type="button" onClick={() => { setEditingSeries(s); setEditingGift(null); setAdding(false); }} className="mr-3 text-xs text-accent-ink hover:underline">Edit</button>
                      <button type="button" onClick={() => deleteSeries(s.id)} className="text-xs text-red-400 hover:text-red-300">Delete</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}


function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-800 bg-gray-900/40 p-8 text-center text-sm text-gray-400">
      {label}
    </div>
  );
}

// ── External Beneficiaries Section ────────────────────────────────────────────

function ExternalBeneficiariesSection({
  clientId,
  externals,
  setExternals,
  canEdit,
}: {
  clientId: string;
  externals: ExternalBeneficiary[];
  setExternals: React.Dispatch<React.SetStateAction<ExternalBeneficiary[]>>;
  canEdit: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [deleting, setDeleting] = useState<ExternalBeneficiary | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <section>
      <header className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-100">External Beneficiaries</h2>
          <p className="text-xs text-gray-400">
            Charities or individuals outside the immediate household.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && externals.length > 0 && (
            <button
              onClick={() => setEditMode((v) => !v)}
              className={`rounded-md border px-3 py-1 text-xs font-medium ${
                editMode
                  ? "border-accent bg-accent/15 text-accent-ink"
                  : "border-gray-600 bg-gray-900 text-gray-300 hover:bg-gray-800"
              }`}
            >
              {editMode ? "Done" : "Edit"}
            </button>
          )}
          {canEdit && (
            <button
              onClick={() => {
                setEditingId(null);
                setAdding(true);
              }}
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-on hover:bg-accent-ink"
            >
              + Add
            </button>
          )}
        </div>
      </header>

      {error && (
        <p className="mb-2 rounded bg-red-900/50 px-3 py-2 text-sm text-red-400">{error}</p>
      )}

      {externals.length === 0 && !adding ? (
        <EmptyState label="No external beneficiaries yet." />
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-800 bg-gray-900/50">
          <table className="min-w-full divide-y divide-gray-800">
            <thead className="bg-gray-800/60">
              <tr className="text-left text-xs font-medium uppercase tracking-wider text-gray-300">
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Kind</th>
                <th className="px-4 py-2">Notes</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {externals.map((x) =>
                editingId === x.id ? (
                  <ExternalBeneficiaryRowForm
                    key={x.id}
                    clientId={clientId}
                    initial={x}
                    onCancel={() => setEditingId(null)}
                    onSaved={(saved) => {
                      setExternals((prev) =>
                        prev.map((p) => (p.id === saved.id ? saved : p)),
                      );
                      setEditingId(null);
                    }}
                    onError={setError}
                  />
                ) : (
                  <tr
                    key={x.id}
                    className={canEdit ? "cursor-pointer hover:bg-gray-800/50" : ""}
                    onClick={canEdit ? () => {
                      if (editMode) return;
                      setEditingId(x.id);
                    } : undefined}
                  >
                    <td className="px-4 py-2 text-sm text-gray-100">{x.name}</td>
                    <td className="px-4 py-2 text-sm text-gray-300 capitalize">{x.kind}</td>
                    <td className="px-4 py-2 text-sm text-gray-400 truncate max-w-[260px]">
                      {x.notes ?? ""}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {editMode && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleting(x);
                          }}
                          className="text-white hover:text-white"
                          aria-label={`Delete ${x.name}`}
                        >
                          <TrashIcon />
                        </button>
                      )}
                    </td>
                  </tr>
                ),
              )}
              {adding && (
                <ExternalBeneficiaryRowForm
                  clientId={clientId}
                  onCancel={() => setAdding(false)}
                  onSaved={(saved) => {
                    setExternals((prev) => [...prev, saved]);
                    setAdding(false);
                  }}
                  onError={setError}
                />
              )}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDeleteDialog
        open={!!deleting}
        title="Delete External Beneficiary"
        message={deleting ? `Delete ${deleting.name}?` : ""}
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          const res = await fetch(
            `/api/clients/${clientId}/external-beneficiaries/${deleting.id}`,
            { method: "DELETE" },
          );
          if (res.ok || res.status === 204) {
            setExternals((prev) => prev.filter((x) => x.id !== deleting.id));
            setDeleting(null);
          } else {
            const j = await res.json().catch(() => ({}));
            setError(j.error ?? `Failed to delete (HTTP ${res.status})`);
            setDeleting(null);
          }
        }}
      />
    </section>
  );
}

function ExternalBeneficiaryRowForm({
  clientId,
  initial,
  onCancel,
  onSaved,
  onError,
}: {
  clientId: string;
  initial?: ExternalBeneficiary;
  onCancel: () => void;
  onSaved: (saved: ExternalBeneficiary) => void;
  onError: (msg: string | null) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [kind, setKind] = useState<"charity" | "individual">(initial?.kind ?? "charity");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!name.trim()) {
      onError("Name is required");
      return;
    }
    setSaving(true);
    onError(null);
    try {
      const isEdit = Boolean(initial);
      const url = isEdit
        ? `/api/clients/${clientId}/external-beneficiaries/${initial!.id}`
        : `/api/clients/${clientId}/external-beneficiaries`;
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), kind, notes: notes.trim() || null }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const saved = (await res.json()) as ExternalBeneficiary;
      onSaved(saved);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr className="bg-gray-800/30">
      <td className="px-4 py-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          className="w-full rounded-md border border-gray-600 bg-gray-800 px-2 py-1 text-sm text-gray-100 focus:border-accent focus:outline-none"
        />
      </td>
      <td className="px-4 py-2">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as "charity" | "individual")}
          className="rounded-md border border-gray-600 bg-gray-800 px-2 py-1 text-sm text-gray-100 focus:border-accent focus:outline-none"
        >
          <option value="charity">Charity</option>
          <option value="individual">Individual</option>
        </select>
      </td>
      <td className="px-4 py-2">
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes"
          className="w-full rounded-md border border-gray-600 bg-gray-800 px-2 py-1 text-sm text-gray-100 focus:border-accent focus:outline-none"
        />
      </td>
      <td className="px-4 py-2 text-right whitespace-nowrap">
        <button
          onClick={submit}
          disabled={saving}
          className="mr-2 rounded-md bg-accent px-3 py-1 text-xs font-medium text-accent-on hover:bg-accent-ink disabled:opacity-50"
        >
          {saving ? "…" : "Save"}
        </button>
        <button
          onClick={onCancel}
          className="rounded-md border border-gray-600 bg-gray-900 px-3 py-1 text-xs font-medium text-gray-300 hover:bg-gray-800"
        >
          Cancel
        </button>
      </td>
    </tr>
  );
}


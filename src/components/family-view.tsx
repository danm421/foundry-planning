"use client";

import { useState } from "react";
import BeneficiaryEditor from "./beneficiary-editor";
import ConfirmDeleteDialog from "./confirm-delete-dialog";
import AddClientDialog from "./add-client-dialog";
import EntityDialog from "./entity-dialog";
import type { ClientFormInitial } from "./forms/add-client-form";
import { type TrustSubType } from "@/lib/entities/trust";
import {
  computeGiftTaxTreatment,
  type GiftContext,
} from "@/lib/gifts/compute-tax-treatment";
import { beaForYear } from "@/lib/tax/estate";

// ── Types ─────────────────────────────────────────────────────────────────────

type Relationship = "child" | "grandchild" | "parent" | "sibling" | "other";
export type EntityType = "trust" | "llc" | "s_corp" | "c_corp" | "partnership" | "foundation" | "other";

export interface FamilyMember {
  id: string;
  firstName: string;
  lastName: string | null;
  relationship: Relationship;
  dateOfBirth: string | null;
  notes: string | null;
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
  value: string;
  owner: "client" | "spouse" | "joint" | null;
  grantor: "client" | "spouse" | null;
  beneficiaries: NamePctRow[] | null;
  trustSubType: TrustSubType | null;
  isIrrevocable: boolean | null;
  trustee: string | null;
  exemptionConsumed: string;
}

export type Gift = {
  id: string;
  year: number;
  amount: number;
  grantor: "client" | "spouse" | "joint";
  recipientEntityId: string | null;
  recipientFamilyMemberId: string | null;
  recipientExternalBeneficiaryId: string | null;
  useCrummeyPowers: boolean;
  notes: string | null;
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

export type Tier = "primary" | "contingent";

export type Designation = {
  id: string;
  targetKind: "account" | "trust";
  accountId: string | null;
  entityId: string | null;
  tier: Tier;
  familyMemberId: string | null;
  externalBeneficiaryId: string | null;
  percentage: number;
  sortOrder: number;
};

export interface PrimaryInfo {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  retirementAge: number;
  lifeExpectancy: number;
  filingStatus: string;
  spouseName: string | null;
  spouseLastName: string | null;
  spouseDob: string | null;
  spouseRetirementAge: number | null;
  spouseLifeExpectancy: number | null;
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
  /**
   * Annual inflation rate used to grow the federal estate-tax basic exclusion
   * amount (BEA) past the 2026 baseline. Sourced from `plan_settings.tax_inflation_rate`.
   * Falls back to 0.03 when not provided (page does not yet fetch plan_settings here).
   */
  taxInflationRate?: number;
}

const RELATIONSHIP_LABELS: Record<Relationship, string> = {
  child: "Child",
  grandchild: "Grandchild",
  parent: "Parent",
  sibling: "Sibling",
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

// ── Family Member Dialog ──────────────────────────────────────────────────────

interface FamilyMemberDialogProps {
  clientId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: FamilyMember;
  onSaved: (member: FamilyMember, mode: "create" | "edit") => void;
  onRequestDelete?: () => void;
}

function FamilyMemberDialog({
  clientId,
  open,
  onOpenChange,
  editing,
  onSaved,
  onRequestDelete,
}: FamilyMemberDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isEdit = Boolean(editing);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const data = new FormData(e.currentTarget);
    const body = {
      firstName: data.get("firstName") as string,
      lastName: data.get("lastName") as string,
      relationship: data.get("relationship") as string,
      dateOfBirth: (data.get("dateOfBirth") as string) || null,
      notes: (data.get("notes") as string) || null,
    };
    try {
      const url = isEdit
        ? `/api/clients/${clientId}/family-members/${editing!.id}`
        : `/api/clients/${clientId}/family-members`;
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Failed to save");
      }
      const saved = (await res.json()) as FamilyMember;
      onSaved(saved, isEdit ? "edit" : "create");
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={() => onOpenChange(false)} />
      <div className="relative z-10 w-full max-w-lg rounded-lg bg-gray-900 border border-gray-600 p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-100">
            {isEdit ? "Edit Family Member" : "Add Family Member"}
          </h2>
          <button onClick={() => onOpenChange(false)} className="text-gray-400 hover:text-gray-200">
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <p className="rounded bg-red-900/50 px-3 py-2 text-sm text-red-400">{error}</p>}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300" htmlFor="fm-first">
                First Name <span className="text-red-500">*</span>
              </label>
              <input
                id="fm-first"
                name="firstName"
                type="text"
                required
                defaultValue={editing?.firstName ?? ""}
                className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300" htmlFor="fm-last">Last Name</label>
              <input
                id="fm-last"
                name="lastName"
                type="text"
                defaultValue={editing?.lastName ?? ""}
                className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300" htmlFor="fm-rel">Relationship</label>
              <select
                id="fm-rel"
                name="relationship"
                defaultValue={editing?.relationship ?? "child"}
                className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {Object.entries(RELATIONSHIP_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300" htmlFor="fm-dob">Date of Birth</label>
              <input
                id="fm-dob"
                name="dateOfBirth"
                type="date"
                defaultValue={editing?.dateOfBirth ? String(editing.dateOfBirth).slice(0, 10) : ""}
                className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300" htmlFor="fm-notes">Notes</label>
            <textarea
              id="fm-notes"
              name="notes"
              rows={2}
              defaultValue={editing?.notes ?? ""}
              className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="flex items-center justify-between pt-2">
            {isEdit && onRequestDelete ? (
              <button
                type="button"
                onClick={onRequestDelete}
                className="rounded-md border border-red-700 bg-red-900/30 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-900/60"
              >
                Delete…
              </button>
            ) : (
              <span />
            )}
            <button
              type="submit"
              disabled={loading}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? "Saving…" : isEdit ? "Save Changes" : "Add"}
            </button>
          </div>
        </form>
      </div>
    </div>
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
  taxInflationRate = 0.03,
}: FamilyViewProps) {
  const [members, setMembers] = useState<FamilyMember[]>(initialMembers);
  const [entities, setEntities] = useState<Entity[]>(initialEntities);
  const [externals, setExternals] = useState<ExternalBeneficiary[]>(initialExternalBeneficiaries);
  const [accts, setAccts] = useState<AccountLite[]>(initialAccounts);
  const [designations, setDesignations] = useState<Designation[]>(initialDesignations);
  const [giftsState, setGiftsState] = useState<Gift[]>(initialGifts);

  const [memberDialogOpen, setMemberDialogOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<FamilyMember | undefined>();
  const [deletingMember, setDeletingMember] = useState<FamilyMember | null>(null);
  const [membersEdit, setMembersEdit] = useState(false);

  const [entityDialogOpen, setEntityDialogOpen] = useState(false);
  const [editingEntity, setEditingEntity] = useState<Entity | undefined>();
  const [deletingEntity, setDeletingEntity] = useState<Entity | null>(null);
  const [entitiesEdit, setEntitiesEdit] = useState(false);

  const primaryAge = computeAge(primary.dateOfBirth);
  const spouseAge = primary.spouseDob ? computeAge(primary.spouseDob) : null;

  const [editProfileOpen, setEditProfileOpen] = useState(false);

  const profileInitial: ClientFormInitial = {
    id: clientId,
    firstName: primary.firstName,
    lastName: primary.lastName,
    dateOfBirth: primary.dateOfBirth,
    retirementAge: primary.retirementAge,
    lifeExpectancy: primary.lifeExpectancy,
    filingStatus: primary.filingStatus,
    spouseName: primary.spouseName,
    spouseLastName: primary.spouseLastName,
    spouseDob: primary.spouseDob,
    spouseRetirementAge: primary.spouseRetirementAge,
    spouseLifeExpectancy: primary.spouseLifeExpectancy,
  };

  // Group members by relationship
  const byRel: Record<Relationship, FamilyMember[]> = {
    child: [],
    grandchild: [],
    parent: [],
    sibling: [],
    other: [],
  };
  for (const m of members) byRel[m.relationship].push(m);

  return (
    <div className="space-y-8">
      {/* Primary household */}
      <section>
        <header className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-100">Household</h2>
            <p className="text-xs text-gray-500">Client and spouse. Edit from the Clients list.</p>
          </div>
          <button
            onClick={() => setEditProfileOpen(true)}
            className="rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-700"
          >
            Edit profile
          </button>
        </header>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <PersonCard
            name={`${primary.firstName} ${primary.lastName}`}
            badge="Client"
            fields={[
              ["Date of Birth", primary.dateOfBirth ? `${new Date(primary.dateOfBirth).toLocaleDateString()} (age ${primaryAge})` : "—"],
              ["Retirement Age", String(primary.retirementAge)],
              ["Life Expectancy", String(primary.lifeExpectancy)],
            ]}
          />
          {primary.spouseName ? (
            <PersonCard
              name={`${primary.spouseName} ${primary.spouseLastName ?? primary.lastName}`.trim()}
              badge="Spouse"
              fields={[
                ["Date of Birth", primary.spouseDob ? `${new Date(primary.spouseDob).toLocaleDateString()} (age ${spouseAge})` : "—"],
                ["Retirement Age", primary.spouseRetirementAge ? String(primary.spouseRetirementAge) : "—"],
                ["Life Expectancy", primary.spouseLifeExpectancy != null ? String(primary.spouseLifeExpectancy) : "—"],
              ]}
            />
          ) : (
            <div className="flex items-center justify-center rounded-lg border border-dashed border-gray-800 bg-gray-900/40 p-6 text-sm text-gray-500">
              No spouse on file
            </div>
          )}
        </div>
      </section>

      <AddClientDialog
        open={editProfileOpen}
        onOpenChange={setEditProfileOpen}
        editing={profileInitial}
      />

      {/* Family members */}
      <section>
        <header className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-100">Family Members</h2>
            <p className="text-xs text-gray-500">Children, grandchildren, parents, and others.</p>
          </div>
          <div className="flex items-center gap-2">
            {members.length > 0 && (
              <button
                onClick={() => setMembersEdit((v) => !v)}
                className={`rounded-md border px-3 py-1 text-xs font-medium ${
                  membersEdit
                    ? "border-blue-600 bg-blue-900/40 text-blue-300"
                    : "border-gray-600 bg-gray-900 text-gray-300 hover:bg-gray-800"
                }`}
              >
                {membersEdit ? "Done" : "Edit"}
              </button>
            )}
            <button
              onClick={() => {
                setEditingMember(undefined);
                setMemberDialogOpen(true);
              }}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              + Add
            </button>
          </div>
        </header>

        {members.length === 0 ? (
          <EmptyState label="No family members added yet." />
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-800 bg-gray-900/50">
            <table className="min-w-full divide-y divide-gray-800">
              <thead className="bg-gray-800/60">
                <tr className="text-left text-xs font-medium uppercase tracking-wider text-gray-400">
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
                      className="cursor-pointer hover:bg-gray-800/50"
                      onClick={() => {
                        if (membersEdit) return;
                        setEditingMember(m);
                        setMemberDialogOpen(true);
                      }}
                    >
                      <td className="px-4 py-2 text-sm text-gray-100">
                        {m.firstName} {m.lastName ?? ""}
                      </td>
                      <td className="px-4 py-2 text-sm text-gray-400">{RELATIONSHIP_LABELS[m.relationship]}</td>
                      <td className="px-4 py-2 text-sm text-gray-400">{computeAge(m.dateOfBirth)}</td>
                      <td className="px-4 py-2 text-sm text-gray-500 truncate max-w-[260px]">{m.notes ?? ""}</td>
                      <td className="px-4 py-2 text-right">
                        {membersEdit && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeletingMember(m);
                            }}
                            className="text-gray-500 hover:text-red-400"
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

      {/* Entities */}
      <section>
        <header className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-100">Entities</h2>
            <p className="text-xs text-gray-500">
              Trusts, LLCs, and other entities that can own accounts, incomes, or expenses.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {entities.length > 0 && (
              <button
                onClick={() => setEntitiesEdit((v) => !v)}
                className={`rounded-md border px-3 py-1 text-xs font-medium ${
                  entitiesEdit
                    ? "border-blue-600 bg-blue-900/40 text-blue-300"
                    : "border-gray-600 bg-gray-900 text-gray-300 hover:bg-gray-800"
                }`}
              >
                {entitiesEdit ? "Done" : "Edit"}
              </button>
            )}
            <button
              onClick={() => {
                setEditingEntity(undefined);
                setEntityDialogOpen(true);
              }}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              + Add
            </button>
          </div>
        </header>

        {entities.length === 0 ? (
          <EmptyState label="No entities yet. Add a trust, LLC, or foundation to own assets separately." />
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-800 bg-gray-900/50">
            <table className="min-w-full divide-y divide-gray-800">
              <thead className="bg-gray-800/60">
                <tr className="text-left text-xs font-medium uppercase tracking-wider text-gray-400">
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
                    className="cursor-pointer hover:bg-gray-800/50"
                    onClick={() => {
                      if (entitiesEdit) return;
                      setEditingEntity(e);
                      setEntityDialogOpen(true);
                    }}
                  >
                    <td className="px-4 py-2 text-sm text-gray-100">{e.name}</td>
                    <td className="px-4 py-2 text-sm text-gray-400">{ENTITY_LABELS[e.entityType]}</td>
                    <td className="px-4 py-2 text-sm text-gray-500 truncate max-w-[260px]">{e.notes ?? ""}</td>
                    <td className="px-4 py-2 text-right">
                      {entitiesEdit && (
                        <button
                          onClick={(ev) => {
                            ev.stopPropagation();
                            setDeletingEntity(e);
                          }}
                          className="text-gray-500 hover:text-red-400"
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

      {/* External Beneficiaries */}
      <ExternalBeneficiariesSection
        clientId={clientId}
        externals={externals}
        setExternals={setExternals}
      />

      <GiftsSection
        clientId={clientId}
        members={members}
        externals={externals}
        entities={entities}
        gifts={giftsState}
        onChange={setGiftsState}
      />

      {/* Account Beneficiaries */}
      <section>
        <header className="mb-3">
          <h2 className="text-xl font-bold text-gray-100">Account Beneficiaries</h2>
          <p className="text-xs text-gray-500">
            Primary and contingent beneficiary designations per account. Also set optional
            owner override for individual family members (e.g., UTMA).
          </p>
        </header>

        {accts.length === 0 ? (
          <EmptyState label="No accounts yet." />
        ) : (
          <div className="space-y-2">
            {accts.map((a) => {
              const rows = designations.filter(
                (d) => d.targetKind === "account" && d.accountId === a.id,
              );
              return (
                <details
                  key={a.id}
                  className="rounded-lg border border-gray-800 bg-gray-900/50 p-3"
                >
                  <summary className="cursor-pointer text-sm text-gray-100 flex items-center justify-between">
                    <span>
                      <span className="font-medium">{a.name}</span>
                      <span className="ml-2 text-xs text-gray-500">{a.category}</span>
                    </span>
                    <span className="text-xs text-gray-500">
                      {rows.length} designation{rows.length === 1 ? "" : "s"}
                    </span>
                  </summary>

                  <div className="mt-3 flex items-center gap-2">
                    <label className="text-sm text-gray-300">Owned by family member:</label>
                    <select
                      value={a.ownerFamilyMemberId ?? ""}
                      disabled={!!a.ownerEntityId}
                      onChange={async (e) => {
                        const v = e.target.value || null;
                        const res = await fetch(
                          `/api/clients/${clientId}/accounts/${a.id}`,
                          {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ ownerFamilyMemberId: v }),
                          },
                        );
                        if (res.ok) {
                          setAccts((rows) =>
                            rows.map((r) =>
                              r.id === a.id ? { ...r, ownerFamilyMemberId: v } : r,
                            ),
                          );
                        }
                      }}
                      className="rounded-md border border-gray-600 bg-gray-800 px-2 py-1 text-sm text-gray-100 focus:border-blue-500 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <option value="">— none —</option>
                      {members.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.firstName} {m.lastName ?? ""}
                        </option>
                      ))}
                    </select>
                    {a.ownerEntityId ? (
                      <span className="text-xs text-gray-400">Owned by an entity; clear entity owner first.</span>
                    ) : null}
                  </div>

                  <BeneficiaryEditor
                    target={{ kind: "account", accountId: a.id }}
                    clientId={clientId}
                    members={members}
                    externals={externals}
                    initial={rows}
                    onSaved={(savedRows) => {
                      setDesignations((prev) => [
                        ...prev.filter(
                          (d) => !(d.targetKind === "account" && d.accountId === a.id),
                        ),
                        ...savedRows,
                      ]);
                    }}
                  />
                </details>
              );
            })}
          </div>
        )}
      </section>

      {/* Trust Remainder Beneficiaries */}
      <section>
        <header className="mb-3">
          <h2 className="text-xl font-bold text-gray-100">Trust Remainder Beneficiaries</h2>
          <p className="text-xs text-gray-500">
            Designations for trust remainder distributions.
          </p>
        </header>

        {entities.filter((e) => e.entityType === "trust").length === 0 ? (
          <EmptyState label="No trusts defined." />
        ) : (
          <div className="space-y-2">
            {entities
              .filter((e) => e.entityType === "trust")
              .map((ent) => {
                const rows = designations.filter(
                  (d) => d.targetKind === "trust" && d.entityId === ent.id,
                );
                return (
                  <details
                    key={ent.id}
                    className="rounded-lg border border-gray-800 bg-gray-900/50 p-3"
                  >
                    <summary className="cursor-pointer text-sm text-gray-100 flex items-center justify-between">
                      <span>
                        <span className="font-medium">{ent.name}</span>
                        <span className="ml-2 text-xs text-gray-500">Trust</span>
                      </span>
                      <span className="text-xs text-gray-500">
                        {rows.length} designation{rows.length === 1 ? "" : "s"}
                      </span>
                    </summary>

                    <BeneficiaryEditor
                      target={{ kind: "trust", entityId: ent.id }}
                      clientId={clientId}
                      members={members}
                      externals={externals}
                      initial={rows}
                      onSaved={(savedRows) => {
                        setDesignations((prev) => [
                          ...prev.filter(
                            (d) => !(d.targetKind === "trust" && d.entityId === ent.id),
                          ),
                          ...savedRows,
                        ]);
                      }}
                    />
                    {(() => {
                      if (!(ent.isIrrevocable ?? false)) return null;
                      const openingBalance = parseFloat(ent.exemptionConsumed || "0");
                      const beneficiaryCount = designations.filter(
                        (d) => d.targetKind === "trust" && d.entityId === ent.id && d.tier === "primary",
                      ).length;
                      const lifetimeFromGifts = giftsState
                        .filter((g) => g.recipientEntityId === ent.id)
                        .reduce((acc, g) => {
                          try {
                            const treatment = computeGiftTaxTreatment(
                              {
                                amount: g.amount,
                                useCrummeyPowers: g.useCrummeyPowers,
                                recipientEntityId: g.recipientEntityId,
                                recipientFamilyMemberId: g.recipientFamilyMemberId,
                                recipientExternalBeneficiaryId: g.recipientExternalBeneficiaryId,
                              },
                              {
                                entity: {
                                  isIrrevocable: ent.isIrrevocable ?? false,
                                  entityType: "trust",
                                },
                                annualExclusionAmount: 19_000,
                                crummeyBeneficiaryCount: beneficiaryCount,
                              } as GiftContext,
                            );
                            return acc + treatment.lifetimeUsed;
                          } catch {
                            return acc;
                          }
                        }, 0);
                      const total = openingBalance + lifetimeFromGifts;
                      const exemptionCap = beaForYear(new Date().getFullYear(), taxInflationRate);
                      return (
                        <p className="mt-2 border-t border-gray-800 pt-2 text-xs text-gray-400">
                          Uses exemption · ${(total / 1_000_000).toFixed(2)}M / ${(exemptionCap / 1_000_000).toFixed(2)}M
                        </p>
                      );
                    })()}
                  </details>
                );
              })}
          </div>
        )}
      </section>

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
          onSaved={(e, mode) => {
            if (mode === "create") setEntities((prev) => [...prev, e]);
            else setEntities((prev) => prev.map((x) => (x.id === e.id ? e : x)));
          }}
          onRequestDelete={() => {
            if (editingEntity) setDeletingEntity(editingEntity);
          }}
        />
      )}

      <ConfirmDeleteDialog
        open={!!deletingMember}
        title="Delete Family Member"
        message={deletingMember ? `Delete ${deletingMember.firstName}${deletingMember.lastName ? " " + deletingMember.lastName : ""}?` : ""}
        onCancel={() => setDeletingMember(null)}
        onConfirm={async () => {
          if (!deletingMember) return;
          const res = await fetch(`/api/clients/${clientId}/family-members/${deletingMember.id}`, { method: "DELETE" });
          if (res.ok || res.status === 204) {
            setMembers((prev) => prev.filter((m) => m.id !== deletingMember.id));
            setMemberDialogOpen(false);
            setDeletingMember(null);
          }
        }}
      />

      <ConfirmDeleteDialog
        open={!!deletingEntity}
        title="Delete Entity"
        message={
          deletingEntity
            ? `Delete ${deletingEntity.name}? Any accounts owned by this entity will revert to the primary owner.`
            : ""
        }
        onCancel={() => setDeletingEntity(null)}
        onConfirm={async () => {
          if (!deletingEntity) return;
          const res = await fetch(`/api/clients/${clientId}/entities/${deletingEntity.id}`, { method: "DELETE" });
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
        <span className="rounded bg-gray-800 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-gray-400">
          {badge}
        </span>
      </div>
      <dl className="mt-3 space-y-1.5 text-sm">
        {fields.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4">
            <dt className="text-gray-500">{k}</dt>
            <dd className="text-gray-200">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

type RecipientKind = "trust" | "family" | "external";

function GiftsSection(props: {
  clientId: string;
  members: FamilyMember[];
  externals: ExternalBeneficiary[];
  entities: Entity[];
  gifts: Gift[];
  onChange: (gifts: Gift[]) => void;
}) {
  const [adding, setAdding] = useState(false);

  const resolveRecipient = (g: Gift): { label: string; kind: RecipientKind } | null => {
    if (g.recipientEntityId) {
      const e = props.entities.find((x) => x.id === g.recipientEntityId);
      return e ? { label: e.name, kind: "trust" } : null;
    }
    if (g.recipientFamilyMemberId) {
      const m = props.members.find((x) => x.id === g.recipientFamilyMemberId);
      return m ? { label: `${m.firstName} ${m.lastName ?? ""}`.trim(), kind: "family" } : null;
    }
    if (g.recipientExternalBeneficiaryId) {
      const ex = props.externals.find(
        (x) => x.id === g.recipientExternalBeneficiaryId,
      );
      return ex ? { label: ex.name, kind: "external" } : null;
    }
    return null;
  };

  async function deleteGift(giftId: string) {
    const res = await fetch(`/api/clients/${props.clientId}/gifts/${giftId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      props.onChange(props.gifts.filter((x) => x.id !== giftId));
    }
  }

  return (
    <section className="mt-6 rounded-lg border border-gray-700 bg-gray-900 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-300">
          Gifts
        </h3>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-500"
        >
          {adding ? "Cancel" : "+ Add gift"}
        </button>
      </div>

      {adding && (
        <GiftRowForm
          clientId={props.clientId}
          members={props.members}
          externals={props.externals}
          entities={props.entities}
          onSaved={(newGift) => {
            props.onChange([...props.gifts, newGift]);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {props.gifts.length === 0 ? (
        <p className="text-sm text-gray-500">No gifts recorded.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-gray-400">
              <th className="px-2 py-1">Year</th>
              <th className="px-2 py-1">Grantor</th>
              <th className="px-2 py-1 text-right">Amount</th>
              <th className="px-2 py-1">Recipient</th>
              <th className="px-2 py-1">Crummey</th>
              <th className="px-2 py-1">Notes</th>
              <th className="px-2 py-1"></th>
            </tr>
          </thead>
          <tbody>
            {props.gifts.map((g) => {
              const r = resolveRecipient(g);
              return (
                <tr key={g.id} className="border-t border-gray-800">
                  <td className="px-2 py-1">{g.year}</td>
                  <td className="px-2 py-1 capitalize">{g.grantor}</td>
                  <td className="px-2 py-1 text-right">
                    ${g.amount.toLocaleString()}
                  </td>
                  <td className="px-2 py-1">{r?.label ?? "—"}</td>
                  <td className="px-2 py-1">{g.useCrummeyPowers ? "✓" : ""}</td>
                  <td className="px-2 py-1 text-gray-400">{g.notes ?? ""}</td>
                  <td className="px-2 py-1 text-right">
                    <button
                      type="button"
                      onClick={() => deleteGift(g.id)}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

function GiftRowForm(props: {
  clientId: string;
  members: FamilyMember[];
  externals: ExternalBeneficiary[];
  entities: Entity[];
  onSaved: (g: Gift) => void;
  onCancel: () => void;
}) {
  const trusts = props.entities.filter(
    (e) => e.entityType === "trust" && e.isIrrevocable === true,
  );
  const [year, setYear] = useState<string>(`${new Date().getFullYear()}`);
  const [grantor, setGrantor] = useState<"client" | "spouse" | "joint">("client");
  const [amount, setAmount] = useState<string>("0");
  const [kind, setKind] = useState<RecipientKind>("trust");
  const [recipientId, setRecipientId] = useState<string>("");
  const [crummey, setCrummey] = useState(false);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      if (!recipientId) {
        throw new Error("Please select a recipient.");
      }
      const body: Record<string, unknown> = {
        year: Number(year),
        amount: Number(amount),
        grantor,
        useCrummeyPowers: kind === "trust" ? crummey : false,
        notes: notes.trim() || null,
      };
      if (kind === "trust") body.recipientEntityId = recipientId;
      if (kind === "family") body.recipientFamilyMemberId = recipientId;
      if (kind === "external") body.recipientExternalBeneficiaryId = recipientId;

      const res = await fetch(`/api/clients/${props.clientId}/gifts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const row = await res.json();
      props.onSaved({
        id: row.id,
        year: row.year,
        amount: typeof row.amount === "string" ? parseFloat(row.amount) : row.amount,
        grantor: row.grantor,
        recipientEntityId: row.recipientEntityId ?? null,
        recipientFamilyMemberId: row.recipientFamilyMemberId ?? null,
        recipientExternalBeneficiaryId: row.recipientExternalBeneficiaryId ?? null,
        useCrummeyPowers: row.useCrummeyPowers,
        notes: row.notes ?? null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mb-3 space-y-2 rounded border border-gray-700 bg-gray-800 p-3">
      <div className="grid grid-cols-4 gap-2">
        <div>
          <label className="text-xs text-gray-400">Year</label>
          <input
            type="number"
            min={1900}
            max={2200}
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className="mt-1 block w-full rounded border border-gray-600 bg-gray-900 px-2 py-1 text-sm text-gray-100"
          />
        </div>
        <div>
          <label className="text-xs text-gray-400">Grantor</label>
          <select
            value={grantor}
            onChange={(e) =>
              setGrantor(e.target.value as "client" | "spouse" | "joint")
            }
            className="mt-1 block w-full rounded border border-gray-600 bg-gray-900 px-2 py-1 text-sm text-gray-100"
          >
            <option value="client">Client</option>
            <option value="spouse">Spouse</option>
            <option value="joint">Joint</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-400">Amount ($)</label>
          <input
            type="number"
            min={0}
            step={1000}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="mt-1 block w-full rounded border border-gray-600 bg-gray-900 px-2 py-1 text-sm text-gray-100"
          />
        </div>
        <div>
          <label className="text-xs text-gray-400">Recipient kind</label>
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as RecipientKind);
              setRecipientId("");
              setCrummey(false);
            }}
            className="mt-1 block w-full rounded border border-gray-600 bg-gray-900 px-2 py-1 text-sm text-gray-100"
          >
            <option value="trust">Irrevocable trust</option>
            <option value="family">Family member</option>
            <option value="external">Charity / external</option>
          </select>
        </div>
      </div>

      <div>
        <label className="text-xs text-gray-400">Recipient</label>
        <select
          value={recipientId}
          onChange={(e) => setRecipientId(e.target.value)}
          className="mt-1 block w-full rounded border border-gray-600 bg-gray-900 px-2 py-1 text-sm text-gray-100"
        >
          <option value="">— select —</option>
          {kind === "trust" &&
            trusts.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          {kind === "family" &&
            props.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.firstName} {m.lastName ?? ""}
              </option>
            ))}
          {kind === "external" &&
            props.externals.map((ex) => (
              <option key={ex.id} value={ex.id}>
                {ex.name} ({ex.kind})
              </option>
            ))}
        </select>
      </div>

      {kind === "trust" && recipientId && (
        <label className="flex items-center gap-2 text-sm text-gray-200">
          <input
            type="checkbox"
            checked={crummey}
            onChange={(e) => setCrummey(e.target.checked)}
          />
          Use Crummey powers (annual-exclusion per beneficiary)
        </label>
      )}

      <div>
        <label className="text-xs text-gray-400">Notes</label>
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="mt-1 block w-full rounded border border-gray-600 bg-gray-900 px-2 py-1 text-sm text-gray-100"
        />
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={save}
          className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={props.onCancel}
          className="rounded bg-gray-700 px-3 py-1 text-sm text-gray-100"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-800 bg-gray-900/40 p-8 text-center text-sm text-gray-500">
      {label}
    </div>
  );
}

// ── External Beneficiaries Section ────────────────────────────────────────────

function ExternalBeneficiariesSection({
  clientId,
  externals,
  setExternals,
}: {
  clientId: string;
  externals: ExternalBeneficiary[];
  setExternals: React.Dispatch<React.SetStateAction<ExternalBeneficiary[]>>;
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
          <p className="text-xs text-gray-500">
            Charities or individuals outside the immediate household.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {externals.length > 0 && (
            <button
              onClick={() => setEditMode((v) => !v)}
              className={`rounded-md border px-3 py-1 text-xs font-medium ${
                editMode
                  ? "border-blue-600 bg-blue-900/40 text-blue-300"
                  : "border-gray-600 bg-gray-900 text-gray-300 hover:bg-gray-800"
              }`}
            >
              {editMode ? "Done" : "Edit"}
            </button>
          )}
          <button
            onClick={() => {
              setEditingId(null);
              setAdding(true);
            }}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
          >
            + Add
          </button>
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
              <tr className="text-left text-xs font-medium uppercase tracking-wider text-gray-400">
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
                    className="cursor-pointer hover:bg-gray-800/50"
                    onClick={() => {
                      if (editMode) return;
                      setEditingId(x.id);
                    }}
                  >
                    <td className="px-4 py-2 text-sm text-gray-100">{x.name}</td>
                    <td className="px-4 py-2 text-sm text-gray-400 capitalize">{x.kind}</td>
                    <td className="px-4 py-2 text-sm text-gray-500 truncate max-w-[260px]">
                      {x.notes ?? ""}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {editMode && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleting(x);
                          }}
                          className="text-gray-500 hover:text-red-400"
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
          className="w-full rounded-md border border-gray-600 bg-gray-800 px-2 py-1 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
        />
      </td>
      <td className="px-4 py-2">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as "charity" | "individual")}
          className="rounded-md border border-gray-600 bg-gray-800 px-2 py-1 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
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
          className="w-full rounded-md border border-gray-600 bg-gray-800 px-2 py-1 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
        />
      </td>
      <td className="px-4 py-2 text-right whitespace-nowrap">
        <button
          onClick={submit}
          disabled={saving}
          className="mr-2 rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
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


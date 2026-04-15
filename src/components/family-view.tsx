"use client";

import { useState } from "react";
import ConfirmDeleteDialog from "./confirm-delete-dialog";
import AddClientDialog from "./add-client-dialog";
import type { ClientFormInitial } from "./forms/add-client-form";

// ── Types ─────────────────────────────────────────────────────────────────────

type Relationship = "child" | "grandchild" | "parent" | "sibling" | "other";
type EntityType = "trust" | "llc" | "s_corp" | "c_corp" | "partnership" | "foundation" | "other";

export interface FamilyMember {
  id: string;
  firstName: string;
  lastName: string | null;
  relationship: Relationship;
  dateOfBirth: string | null;
  notes: string | null;
}

export interface Entity {
  id: string;
  name: string;
  entityType: EntityType;
  notes: string | null;
  includeInPortfolio: boolean;
  isGrantor: boolean;
}

export interface PrimaryInfo {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  retirementAge: number;
  planEndAge: number;
  filingStatus: string;
  spouseName: string | null;
  spouseLastName: string | null;
  spouseDob: string | null;
  spouseRetirementAge: number | null;
}

interface FamilyViewProps {
  clientId: string;
  primary: PrimaryInfo;
  initialMembers: FamilyMember[];
  initialEntities: Entity[];
}

const RELATIONSHIP_LABELS: Record<Relationship, string> = {
  child: "Child",
  grandchild: "Grandchild",
  parent: "Parent",
  sibling: "Sibling",
  other: "Other",
};

const ENTITY_LABELS: Record<EntityType, string> = {
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

function TrashIcon() {
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
      <div className="relative z-10 w-full max-w-lg rounded-lg bg-gray-900 border border-gray-700 p-6 shadow-xl">
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

// ── Entity Dialog ─────────────────────────────────────────────────────────────

interface EntityDialogProps {
  clientId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: Entity;
  onSaved: (entity: Entity, mode: "create" | "edit") => void;
  onRequestDelete?: () => void;
}

function EntityDialog({ clientId, open, onOpenChange, editing, onSaved, onRequestDelete }: EntityDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [includeInPortfolio, setIncludeInPortfolio] = useState<boolean>(editing?.includeInPortfolio ?? false);
  const [isGrantor, setIsGrantor] = useState<boolean>(editing?.isGrantor ?? false);
  const isEdit = Boolean(editing);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const data = new FormData(e.currentTarget);
    const body = {
      name: data.get("name") as string,
      entityType: data.get("entityType") as string,
      notes: (data.get("notes") as string) || null,
      includeInPortfolio,
      isGrantor,
    };
    try {
      const url = isEdit
        ? `/api/clients/${clientId}/entities/${editing!.id}`
        : `/api/clients/${clientId}/entities`;
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Failed to save");
      }
      const saved = (await res.json()) as Entity;
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
      <div className="relative z-10 w-full max-w-lg rounded-lg bg-gray-900 border border-gray-700 p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-100">{isEdit ? "Edit Entity" : "Add Entity"}</h2>
          <button onClick={() => onOpenChange(false)} className="text-gray-400 hover:text-gray-200">
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <p className="rounded bg-red-900/50 px-3 py-2 text-sm text-red-400">{error}</p>}

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-300" htmlFor="ent-name">
                Name <span className="text-red-500">*</span>
              </label>
              <input
                id="ent-name"
                name="name"
                type="text"
                required
                defaultValue={editing?.name ?? ""}
                placeholder="e.g., Smith Family Trust"
                className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300" htmlFor="ent-type">Type</label>
              <select
                id="ent-type"
                name="entityType"
                defaultValue={editing?.entityType ?? "trust"}
                className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {Object.entries(ENTITY_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300" htmlFor="ent-notes">Notes</label>
            <textarea
              id="ent-notes"
              name="notes"
              rows={2}
              defaultValue={editing?.notes ?? ""}
              className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="rounded-md border border-gray-800 bg-gray-900/60 p-3 space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              Cash-flow treatment
            </p>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={includeInPortfolio}
                onChange={(e) => setIncludeInPortfolio(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-600 bg-gray-800 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-200">
                Include this entity&apos;s accounts in portfolio assets
                <span className="block text-[11px] text-gray-500">
                  Balances roll into the cash-flow portfolio view even though the assets are out of estate.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isGrantor}
                onChange={(e) => setIsGrantor(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-600 bg-gray-800 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-200">
                Grantor trust (taxes paid by household)
                <span className="block text-[11px] text-gray-500">
                  Income, capital gains, and RMDs from this entity&apos;s accounts are taxed at the household rate.
                </span>
              </span>
            </label>
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

export default function FamilyView({ clientId, primary, initialMembers, initialEntities }: FamilyViewProps) {
  const [members, setMembers] = useState<FamilyMember[]>(initialMembers);
  const [entities, setEntities] = useState<Entity[]>(initialEntities);

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
    planEndAge: primary.planEndAge,
    filingStatus: primary.filingStatus,
    spouseName: primary.spouseName,
    spouseLastName: primary.spouseLastName,
    spouseDob: primary.spouseDob,
    spouseRetirementAge: primary.spouseRetirementAge,
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
              ["Plan End Age", String(primary.planEndAge)],
            ]}
          />
          {primary.spouseName ? (
            <PersonCard
              name={`${primary.spouseName} ${primary.spouseLastName ?? primary.lastName}`.trim()}
              badge="Spouse"
              fields={[
                ["Date of Birth", primary.spouseDob ? `${new Date(primary.spouseDob).toLocaleDateString()} (age ${spouseAge})` : "—"],
                ["Retirement Age", primary.spouseRetirementAge ? String(primary.spouseRetirementAge) : "—"],
                ["Plan End Age", String(primary.planEndAge)],
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

      <FamilyMemberDialog
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

      <EntityDialog
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

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-800 bg-gray-900/40 p-8 text-center text-sm text-gray-500">
      {label}
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface ClientFormInitial {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  retirementAge: number;
  planEndAge: number;
  filingStatus: string;
  /** Spouse first name. Stored in the legacy `spouseName` DB column. */
  spouseName?: string | null;
  spouseLastName?: string | null;
  spouseDob?: string | null;
  spouseRetirementAge?: number | null;
}

interface AddClientFormProps {
  mode?: "create" | "edit";
  initial?: ClientFormInitial;
  onSuccess?: () => void;
  onDelete?: () => void;
}

function toDateInput(v: string | null | undefined): string {
  if (!v) return "";
  // Accept "YYYY-MM-DD" or ISO — keep first 10 chars
  return String(v).slice(0, 10);
}

export default function AddClientForm({ mode = "create", initial, onSuccess, onDelete }: AddClientFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSpouse, setShowSpouse] = useState(Boolean(initial?.spouseName || initial?.spouseDob));

  const isEdit = mode === "edit" && initial;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const form = e.currentTarget;
    const data = new FormData(form);

    const body: Record<string, string | number | null | undefined> = {
      firstName: data.get("firstName") as string,
      lastName: data.get("lastName") as string,
      dateOfBirth: data.get("dateOfBirth") as string,
      retirementAge: Number(data.get("retirementAge")),
      planEndAge: Number(data.get("planEndAge")),
      filingStatus: data.get("filingStatus") as string,
    };

    if (showSpouse) {
      const spouseName = data.get("spouseName") as string;
      const spouseLastName = data.get("spouseLastName") as string;
      const spouseDob = data.get("spouseDob") as string;
      const spouseRetirementAge = data.get("spouseRetirementAge") as string;

      body.spouseName = spouseName || null;
      body.spouseLastName = spouseLastName || null;
      body.spouseDob = spouseDob || null;
      body.spouseRetirementAge = spouseRetirementAge ? Number(spouseRetirementAge) : null;
    } else if (isEdit) {
      body.spouseName = null;
      body.spouseLastName = null;
      body.spouseDob = null;
      body.spouseRetirementAge = null;
    }

    try {
      const url = isEdit ? `/api/clients/${initial!.id}` : "/api/clients";
      const method = isEdit ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Failed to save client");
      }

      router.refresh();
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <p className="rounded bg-red-900/50 px-3 py-2 text-sm text-red-400">{error}</p>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-300" htmlFor="firstName">
            First Name <span className="text-red-500">*</span>
          </label>
          <input
            id="firstName"
            name="firstName"
            type="text"
            required
            defaultValue={initial?.firstName ?? ""}
            className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300" htmlFor="lastName">
            Last Name <span className="text-red-500">*</span>
          </label>
          <input
            id="lastName"
            name="lastName"
            type="text"
            required
            defaultValue={initial?.lastName ?? ""}
            className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300" htmlFor="dateOfBirth">
            Date of Birth <span className="text-red-500">*</span>
          </label>
          <input
            id="dateOfBirth"
            name="dateOfBirth"
            type="date"
            required
            defaultValue={toDateInput(initial?.dateOfBirth)}
            className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300" htmlFor="filingStatus">
            Filing Status <span className="text-red-500">*</span>
          </label>
          <select
            id="filingStatus"
            name="filingStatus"
            required
            defaultValue={initial?.filingStatus ?? "single"}
            className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="single">Single</option>
            <option value="married_joint">Married Filing Jointly</option>
            <option value="married_separate">Married Filing Separately</option>
            <option value="head_of_household">Head of Household</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300" htmlFor="retirementAge">
            Retirement Age <span className="text-red-500">*</span>
          </label>
          <input
            id="retirementAge"
            name="retirementAge"
            type="number"
            min={50}
            max={85}
            defaultValue={initial?.retirementAge ?? 65}
            required
            className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300" htmlFor="planEndAge">
            Plan End Age <span className="text-red-500">*</span>
          </label>
          <input
            id="planEndAge"
            name="planEndAge"
            type="number"
            min={70}
            max={120}
            defaultValue={initial?.planEndAge ?? 90}
            required
            className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="border-t border-gray-700 pt-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={showSpouse}
            onChange={(e) => setShowSpouse(e.target.checked)}
            className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm font-medium text-gray-300">Add Spouse</span>
        </label>

        {showSpouse && (
          <div className="mt-3 grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300" htmlFor="spouseName">
                Spouse First Name
              </label>
              <input
                id="spouseName"
                name="spouseName"
                type="text"
                defaultValue={initial?.spouseName ?? ""}
                className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300" htmlFor="spouseLastName">
                Spouse Last Name
              </label>
              <input
                id="spouseLastName"
                name="spouseLastName"
                type="text"
                placeholder="Leave blank to inherit client's"
                defaultValue={initial?.spouseLastName ?? ""}
                className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300" htmlFor="spouseDob">
                Spouse Date of Birth
              </label>
              <input
                id="spouseDob"
                name="spouseDob"
                type="date"
                defaultValue={toDateInput(initial?.spouseDob)}
                className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300" htmlFor="spouseRetirementAge">
                Spouse Retirement Age
              </label>
              <input
                id="spouseRetirementAge"
                name="spouseRetirementAge"
                type="number"
                min={50}
                max={85}
                defaultValue={initial?.spouseRetirementAge ?? ""}
                className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between pt-2">
        {isEdit && onDelete ? (
          <button
            type="button"
            onClick={onDelete}
            className="rounded-md border border-red-700 bg-red-900/30 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-900/60"
          >
            Delete Client…
          </button>
        ) : (
          <span />
        )}
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Saving…" : isEdit ? "Save Changes" : "Create Client"}
        </button>
      </div>
    </form>
  );
}

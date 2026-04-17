"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import MilestoneYearPicker from "../milestone-year-picker";
import type { YearRef, ClientMilestones } from "@/lib/milestones";
import { resolveMilestone } from "@/lib/milestones";

export interface LiabilityFormInitial {
  id: string;
  name: string;
  balance: string;
  interestRate: string; // decimal fraction, e.g. "0.065"
  monthlyPayment: string;
  startYear: number;
  endYear: number;
  linkedPropertyId?: string | null;
  ownerEntityId?: string | null;
  startYearRef?: string | null;
  endYearRef?: string | null;
  isInterestDeductible?: boolean;
}

interface AddLiabilityFormProps {
  clientId: string;
  realEstateAccounts?: { id: string; name: string }[];
  entities?: { id: string; name: string }[];
  milestones?: ClientMilestones;
  mode?: "create" | "edit";
  initial?: LiabilityFormInitial;
  onSuccess?: () => void;
  onDelete?: () => void;
}

export default function AddLiabilityForm({
  clientId,
  realEstateAccounts,
  entities,
  milestones,
  mode = "create",
  initial,
  onSuccess,
  onDelete,
}: AddLiabilityFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ownerEntityId, setOwnerEntityId] = useState<string>(initial?.ownerEntityId ?? "");
  const [isInterestDeductible, setIsInterestDeductible] = useState(initial?.isInterestDeductible ?? false);
  const isEdit = mode === "edit" && !!initial;

  const currentYear = new Date().getFullYear();
  const initialInterestPct = initial
    ? Math.round(Number(initial.interestRate) * 10000) / 100
    : 0;

  const [startYearRef, setStartYearRef] = useState<YearRef | null>(
    (initial?.startYearRef as YearRef) ?? (!isEdit ? "plan_start" as YearRef : null)
  );
  const [endYearRef, setEndYearRef] = useState<YearRef | null>(
    (initial?.endYearRef as YearRef) ?? null
  );
  const [startYear, setStartYear] = useState<number>(
    initial?.startYear ?? (startYearRef && milestones ? resolveMilestone(startYearRef, milestones) ?? currentYear : currentYear)
  );
  const [endYear, setEndYear] = useState<number>(
    initial?.endYear ?? (endYearRef && milestones ? resolveMilestone(endYearRef, milestones) ?? (currentYear + 30) : currentYear + 30)
  );

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const form = e.currentTarget;
    const data = new FormData(form);
    const linkedPropertyId = data.get("linkedPropertyId") as string;

    const body = {
      name: data.get("name") as string,
      balance: data.get("balance") as string,
      interestRate: String(Number(data.get("interestRate")) / 100),
      monthlyPayment: data.get("monthlyPayment") as string,
      startYear,
      endYear,
      linkedPropertyId: linkedPropertyId || null,
      ownerEntityId: ownerEntityId || null,
      startYearRef,
      endYearRef,
      isInterestDeductible,
    };

    try {
      const url = isEdit
        ? `/api/clients/${clientId}/liabilities/${initial!.id}`
        : `/api/clients/${clientId}/liabilities`;
      const method = isEdit ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Failed to save liability");
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

      <div>
        <label className="block text-sm font-medium text-gray-300" htmlFor="name">
          Liability Name <span className="text-red-500">*</span>
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          defaultValue={initial?.name ?? ""}
          placeholder="e.g., Primary Mortgage"
          className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-300" htmlFor="balance">
            Outstanding Balance ($)
          </label>
          <input
            id="balance"
            name="balance"
            type="number"
            step="0.01"
            min={0}
            defaultValue={initial?.balance ?? 0}
            className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300" htmlFor="interestRate">
            Interest Rate (%)
          </label>
          <input
            id="interestRate"
            name="interestRate"
            type="number"
            step="0.01"
            min={0}
            max={50}
            defaultValue={initialInterestPct}
            className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300" htmlFor="monthlyPayment">
            Monthly Payment ($)
          </label>
          <input
            id="monthlyPayment"
            name="monthlyPayment"
            type="number"
            step="0.01"
            min={0}
            defaultValue={initial?.monthlyPayment ?? 0}
            className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {realEstateAccounts && realEstateAccounts.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-300" htmlFor="linkedPropertyId">
              Linked Property
            </label>
            <select
              id="linkedPropertyId"
              name="linkedPropertyId"
              defaultValue={initial?.linkedPropertyId ?? ""}
              className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">None</option>
              {realEstateAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
        )}

        {entities && entities.length > 0 && (
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-300" htmlFor="ownerEntityId">
              Owed by entity (out of estate)
            </label>
            <select
              id="ownerEntityId"
              value={ownerEntityId}
              onChange={(e) => setOwnerEntityId(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">Household (client/spouse)</option>
              {entities.map((ent) => (
                <option key={ent.id} value={ent.id}>{ent.name}</option>
              ))}
            </select>
            {ownerEntityId && (
              <p className="mt-1 text-xs text-amber-400">Counted as out of estate.</p>
            )}
          </div>
        )}

        <div className="col-span-2">
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={isInterestDeductible}
              onChange={(e) => setIsInterestDeductible(e.target.checked)}
              className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-blue-600 focus:ring-blue-500"
            />
            Interest is tax-deductible
          </label>
          <p className="mt-1 ml-6 text-xs text-gray-500">
            When checked, the annual interest portion flows into your itemized deductions (e.g., mortgage interest).
          </p>
        </div>

        {milestones ? (
          <>
            <MilestoneYearPicker
              name="startYear"
              id="startYear"
              value={startYear}
              yearRef={startYearRef}
              milestones={milestones}
              showSSRefs={false}
              onChange={(yr, ref) => { setStartYear(yr); setStartYearRef(ref); }}
              label="Start Year"
            />
            <MilestoneYearPicker
              name="endYear"
              id="endYear"
              value={endYear}
              yearRef={endYearRef}
              milestones={milestones}
              showSSRefs={false}
              onChange={(yr, ref) => { setEndYear(yr); setEndYearRef(ref); }}
              label="End Year"
            />
          </>
        ) : (
          <>
            <div>
              <label className="block text-xs font-medium text-gray-400" htmlFor="startYear">
                Start Year
              </label>
              <input
                id="startYear"
                name="startYear"
                type="number"
                required
                value={startYear}
                onChange={(e) => { setStartYear(Number(e.target.value)); setStartYearRef(null); }}
                className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400" htmlFor="endYear">
                End Year
              </label>
              <input
                id="endYear"
                name="endYear"
                type="number"
                required
                value={endYear}
                onChange={(e) => { setEndYear(Number(e.target.value)); setEndYearRef(null); }}
                className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </>
        )}
      </div>

      <div className="flex items-center justify-between pt-2">
        {isEdit && onDelete ? (
          <button
            type="button"
            onClick={onDelete}
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
          {loading ? "Saving…" : isEdit ? "Save Changes" : "Add Liability"}
        </button>
      </div>
    </form>
  );
}

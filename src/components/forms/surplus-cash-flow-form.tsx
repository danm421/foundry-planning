"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PercentInput } from "@/components/percent-input";
import { HelpTip } from "@/components/help-tip";
import { useClientAccess } from "@/components/client-access-provider";

interface SurplusCashFlowFormProps {
  clientId: string;
  surplusSpendPct: string;
  surplusSaveAccountId: string | null;
  householdAccounts: Array<{ id: string; name: string }>;
}

const pct = (v: string) => (Number(v) * 100).toFixed(2);

const INPUT_CLS =
  "block w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

export default function SurplusCashFlowForm({
  clientId,
  surplusSpendPct,
  surplusSaveAccountId,
  householdAccounts,
}: SurplusCashFlowFormProps) {
  const { permission } = useClientAccess();
  const canEdit = permission === "edit";
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);

    const data = new FormData(e.currentTarget);
    const body = {
      surplusSpendPct: String(Number(data.get("surplusSpendPct") as string) / 100),
      surplusSaveAccountId: (data.get("surplusSaveAccountId") as string) || null,
    };

    try {
      const res = await fetch(`/api/clients/${clientId}/plan-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Failed to save");
      }
      setSuccess(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error && <p className="rounded bg-red-900/50 px-3 py-2 text-sm text-red-400">{error}</p>}
      {success && <p className="rounded bg-green-900/50 px-3 py-2 text-sm text-green-400">Saved.</p>}

      <fieldset disabled={!canEdit} className="space-y-3 border-0 p-0 m-0">
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-300">
            Surplus Cash Flow
          </h3>
          <HelpTip text="Controls what happens to any positive net cash flow each year, after savings, gifts, and taxes are applied. By default, surplus accumulates in the household checking account." />
        </div>

        <div className="grid grid-cols-2 gap-4 rounded-md border border-gray-800 bg-gray-900/40 p-3">
          <div>
            <label className="block text-xs font-medium text-gray-300" htmlFor="surplusSpendPct">
              Spend % of surplus
            </label>
            <PercentInput
              id="surplusSpendPct"
              name="surplusSpendPct"
              defaultValue={pct(surplusSpendPct)}
              className={`${INPUT_CLS} mt-1`}
            />
            <p className="mt-1 text-xs text-gray-500">
              The spent portion appears as &quot;Surplus spent&quot; on the Cash Flow report.
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-300" htmlFor="surplusSaveAccountId">
              Save remainder to
            </label>
            <select
              id="surplusSaveAccountId"
              name="surplusSaveAccountId"
              defaultValue={surplusSaveAccountId ?? ""}
              className={`${INPUT_CLS} mt-1`}
            >
              <option value="">Household checking (default)</option>
              {householdAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
        </div>

        {canEdit && (
          <div className="flex justify-end pt-1">
            <button
              type="submit"
              disabled={loading}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-on hover:bg-accent-ink disabled:opacity-50"
            >
              {loading ? "Saving..." : "Save"}
            </button>
          </div>
        )}
      </fieldset>
    </form>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface Props {
  clientId: string;
  modelPortfolios: { id: string; name: string }[];
  selectedBenchmarkPortfolioId: string | null;
}

export default function BenchmarkSelector({ clientId, modelPortfolios, selectedBenchmarkPortfolioId }: Props) {
  const [value, setValue] = useState<string>(selectedBenchmarkPortfolioId ?? "");
  const [saving, startTransition] = useTransition();
  const router = useRouter();

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value || null;
    setValue(e.target.value);
    try {
      const res = await fetch(`/api/clients/${clientId}/plan-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedBenchmarkPortfolioId: next }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
    } catch (err) {
      console.error("Benchmark save failed:", err);
      setValue(selectedBenchmarkPortfolioId ?? "");
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <label className="flex items-center gap-2 text-sm text-gray-400">
      <span>Target Portfolio:</span>
      <select
        value={value}
        onChange={handleChange}
        disabled={saving}
        className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-gray-200"
      >
        <option value="">— Select —</option>
        {modelPortfolios.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}

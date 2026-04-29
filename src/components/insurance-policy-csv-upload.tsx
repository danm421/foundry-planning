"use client";

import { useState } from "react";
import { parseCashValueCsv } from "@/lib/insurance-policies/csv";

interface InsurancePolicyCsvUploadProps {
  onParsed: (rows: { year: number; cashValue: number }[]) => void;
}

export default function InsurancePolicyCsvUpload({
  onParsed,
}: InsurancePolicyCsvUploadProps) {
  const [errors, setErrors] = useState<string[]>([]);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input so that re-selecting the same file re-triggers onChange.
    e.target.value = "";
    if (!file) return;
    setErrors([]);
    setSuccess(null);
    try {
      const text = await file.text();
      const parsed = parseCashValueCsv(text);
      if (parsed.errors.length === 0) {
        onParsed(parsed.rows);
        setSuccess(`Loaded ${parsed.rows.length} rows from CSV.`);
      } else {
        setErrors(parsed.errors);
      }
    } catch (err) {
      setErrors([err instanceof Error ? err.message : String(err)]);
    }
  }

  return (
    <div className="mb-3 rounded-md border border-gray-700 bg-gray-800/40 p-3">
      <label className="block text-xs font-medium text-gray-300">
        Upload CSV (headers: year, cash_value)
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={handleFile}
          className="mt-1 block w-full text-xs text-gray-200 file:mr-3 file:rounded-md file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-accent-on hover:file:bg-accent-deep"
        />
      </label>
      {success && (
        <p className="mt-2 text-xs text-green-400">{success}</p>
      )}
      {errors.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-red-400">
          {errors.map((err, i) => (
            <li key={i}>{err}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

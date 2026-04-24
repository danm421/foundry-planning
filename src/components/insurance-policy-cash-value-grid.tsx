"use client";

import InsurancePolicyCsvUpload from "./insurance-policy-csv-upload";

interface InsurancePolicyCashValueGridProps {
  rows: { year: number; cashValue: number }[];
  onChange: (rows: { year: number; cashValue: number }[]) => void;
}

// Coerce a text input value → integer. Empty string becomes 0.
function toInt(raw: string): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

// Coerce a text input value → number. Empty string becomes 0.
function toNum(raw: string): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export default function InsurancePolicyCashValueGrid({
  rows,
  onChange,
}: InsurancePolicyCashValueGridProps) {
  function updateRow(
    index: number,
    patch: Partial<{ year: number; cashValue: number }>,
  ) {
    const next = rows.map((r, i) => (i === index ? { ...r, ...patch } : r));
    onChange(next);
  }

  function removeRow(index: number) {
    const next = rows.filter((_, i) => i !== index);
    onChange(next);
  }

  function addRow() {
    onChange([...rows, { year: 0, cashValue: 0 }]);
  }

  return (
    <div>
      <InsurancePolicyCsvUpload onParsed={onChange} />

      {rows.length === 0 ? (
        <p className="mb-3 text-xs text-gray-500">
          No schedule rows yet. Add rows manually or upload a CSV.
        </p>
      ) : (
        <table className="mb-3 w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-gray-400">
              <th className="py-1 pr-2 font-medium">Year</th>
              <th className="py-1 pr-2 text-right font-medium">Cash value</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-t border-gray-800">
                <td className="py-1 pr-2">
                  <input
                    type="number"
                    min="1900"
                    max="2200"
                    step="1"
                    value={row.year}
                    onChange={(e) =>
                      updateRow(i, { year: toInt(e.target.value) })
                    }
                    className="w-24 rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
                  />
                </td>
                <td className="py-1 pr-2 text-right">
                  <input
                    type="number"
                    min="0"
                    step="1000"
                    value={row.cashValue}
                    onChange={(e) =>
                      updateRow(i, { cashValue: toNum(e.target.value) })
                    }
                    className="w-32 rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-right text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
                  />
                </td>
                <td className="py-1 text-right">
                  <button
                    type="button"
                    onClick={() => removeRow(i)}
                    aria-label={`Remove year ${row.year}`}
                    className="px-2 text-gray-500 hover:text-red-400"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <button
        type="button"
        onClick={addRow}
        className="text-xs text-blue-400 hover:text-blue-300"
      >
        + Add row
      </button>
    </div>
  );
}

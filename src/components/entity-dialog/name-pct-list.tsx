"use client";

import { TrashIcon, type NamePctRow } from "../family-view";

interface NamePctListProps {
  label: string;
  rows: NamePctRow[];
  onChange: (rows: NamePctRow[]) => void;
}

export default function NamePctList({ label, rows, onChange }: NamePctListProps) {
  const total = rows.reduce((sum, r) => sum + (Number(r.pct) || 0), 0);
  return (
    <div className="rounded-md border border-gray-800 bg-gray-900/60 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-300">{label}</p>
        <button
          type="button"
          onClick={() => onChange([...rows, { name: "", pct: 0 }])}
          className="text-xs text-blue-400 hover:text-blue-300"
        >
          + Add
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-gray-400">None</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Name"
                value={row.name}
                onChange={(e) => {
                  const next = [...rows];
                  next[i] = { ...next[i], name: e.target.value };
                  onChange(next);
                }}
                className="flex-1 rounded-md border border-gray-600 bg-gray-800 px-2 py-1 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
              />
              <input
                type="number"
                step="0.01"
                min="0"
                max="100"
                placeholder="%"
                value={row.pct || ""}
                onChange={(e) => {
                  const next = [...rows];
                  next[i] = { ...next[i], pct: Number(e.target.value) };
                  onChange(next);
                }}
                className="w-20 rounded-md border border-gray-600 bg-gray-800 px-2 py-1 text-right text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
                className="text-gray-400 hover:text-red-400"
                aria-label={`Remove ${label.toLowerCase()} row`}
              >
                <TrashIcon />
              </button>
            </div>
          ))}
          <p className={`text-right text-xs ${Math.abs(total - 100) < 0.01 || total === 0 ? "text-gray-400" : "text-amber-400"}`}>
            Total: {total.toFixed(2)}%
          </p>
        </div>
      )}
    </div>
  );
}

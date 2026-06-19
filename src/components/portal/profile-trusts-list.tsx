"use client";

import { useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";

type Row = {
  id: string;
  name: string;
  entityType: string;
  value: string;
  isGrantor: boolean;
};

interface Props {
  rows: Row[];
  editEnabled: boolean;
}

export default function ProfileTrustsList({
  rows,
  editEnabled,
}: Props): ReactElement {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function rename(id: string, current: string) {
    const next = prompt("Trust name", current);
    if (next == null || next === current) return;
    setError(null);
    const res = await fetch(`/api/portal/trusts/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: next }),
    });
    if (!res.ok) {
      setError((await res.json().catch(() => ({ error: "Failed to rename trust" }))).error);
      return;
    }
    router.refresh();
  }

  return (
    <div>
      {error && <p className="mb-2 text-[12px] text-bad">{error}</p>}
      <header className="flex items-center justify-between mb-3">
        <h1 className="text-[18px] font-semibold text-ink">Trusts</h1>
      </header>

      {rows.length === 0 ? (
        <p className="text-[13px] text-ink-3">No trusts on file.</p>
      ) : (
        <ul className="divide-y divide-hair rounded-md border border-hair bg-paper">
          {rows.map((r) => (
            <li key={r.id} className="p-3 flex items-center gap-3">
              <div className="flex-1">
                <div className="text-[14px] text-ink">{r.name}</div>
                <div className="text-[12px] text-ink-3">
                  {r.entityType}
                  {r.isGrantor ? " · grantor trust" : ""}
                </div>
              </div>
              <div className="text-[13px] text-ink-2 tabular-nums">
                ${Number(r.value).toLocaleString()}
              </div>
              {editEnabled && (
                <button
                  type="button"
                  onClick={() => rename(r.id, r.name)}
                  className="text-[12px] text-ink-2 hover:text-ink"
                >
                  Rename
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

import Link from "next/link";
import type { SharedRow } from "@/app/(app)/clients/clients-content";

// ---------------------------------------------------------------------------
// Inline SVG — lucide-react is absent in this worktree.
// ---------------------------------------------------------------------------

function IconInbox() {
  return (
    <svg
      className="h-8 w-8 text-ink-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Permission chip
// ---------------------------------------------------------------------------

function PermissionChip({ permission }: { permission: "view" | "edit" }) {
  if (permission === "edit") {
    return (
      <span className="inline-flex items-center rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider text-accent">
        Can edit
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border border-hair bg-card-2 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider text-ink-3">
      View
    </span>
  );
}

// ---------------------------------------------------------------------------
// Table header style (mirrors unified-clients-table.tsx)
// ---------------------------------------------------------------------------

const TH = "px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-3";

// ---------------------------------------------------------------------------
// SharedWithMeTable
// ---------------------------------------------------------------------------

interface Props {
  rows: SharedRow[];
}

export function SharedWithMeTable({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <div className="mt-4 overflow-hidden rounded-lg border border-hair bg-card shadow-sm">
        <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
          <IconInbox />
          <p className="text-sm text-ink-3">Nothing has been shared with you yet.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-hair bg-card shadow-sm">
      <table className="min-w-full divide-y divide-hair">
        <thead className="bg-card-2">
          <tr>
            <th className={TH}>Client</th>
            <th className={TH}>Shared by</th>
            <th className={TH}>Permission</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hair">
          {rows.map((row) => (
            <tr key={row.clientId} className="hover:bg-card-2">
              {/* Client name — links to the planning detail page */}
              <td className="whitespace-nowrap px-6 py-4">
                <Link
                  href={`/clients/${row.clientId}/overview`}
                  className="font-medium text-ink hover:text-accent hover:underline"
                >
                  {row.displayName}
                </Link>
              </td>

              {/* Sharer badge: "Shared by {name} · {firm}" */}
              <td className="whitespace-nowrap px-6 py-4">
                <span data-testid="sharer-badge" className="inline-flex items-center gap-1.5 rounded-full border border-hair bg-card-2 px-2.5 py-1 text-[12px] text-ink-2">
                  {/* Person icon */}
                  <svg
                    className="h-3 w-3 shrink-0 text-ink-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  <span>
                    Shared by <span className="font-medium text-ink">{row.ownerName}</span>
                    {" · "}
                    <span className="text-ink-3">{row.firmName}</span>
                  </span>
                </span>
              </td>

              {/* Permission chip */}
              <td className="whitespace-nowrap px-6 py-4">
                <PermissionChip permission={row.permission} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

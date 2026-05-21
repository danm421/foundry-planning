"use client";

import Link from "next/link";

interface CrmContact {
  role: string;
  firstName: string;
  lastName: string;
}

export interface CrmHouseholdRow {
  id: string;
  name: string;
  status: string;
  contacts: CrmContact[];
  createdAt: string | Date;
  updatedAt: string | Date;
}

interface CrmHouseholdTableProps {
  households: CrmHouseholdRow[];
}

const STATUS_LABELS: Record<string, string> = {
  prospect: "Prospect",
  active: "Active",
  inactive: "Inactive",
  archived: "Archived",
};

function fullName(c: CrmContact | undefined): string {
  if (!c) return "—";
  return `${c.firstName} ${c.lastName}`.trim() || "—";
}

export function CrmHouseholdTable({ households }: CrmHouseholdTableProps) {
  if (households.length === 0) {
    return (
      <div className="mt-4 overflow-hidden rounded-lg border border-hair bg-card shadow-sm">
        <div className="px-6 py-12 text-center">
          <p className="text-ink-3">No households yet. Click &quot;New Household&quot; to get started.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-hair bg-card shadow-sm">
      <table className="min-w-full divide-y divide-hair">
        <thead className="bg-card-2">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-3">Name</th>
            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-3">Status</th>
            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-3">Primary contact</th>
            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-3">Spouse</th>
            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-3">Updated</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hair">
          {households.map((h) => {
            const primary = h.contacts.find((c) => c.role === "primary");
            const spouse = h.contacts.find((c) => c.role === "spouse");
            const updated = new Date(h.updatedAt);
            return (
              <tr key={h.id} className="hover:bg-card-2">
                <td className="whitespace-nowrap px-6 py-4">
                  <Link
                    href={`/crm/households/${h.id}`}
                    className="font-medium text-accent hover:text-accent"
                  >
                    {h.name}
                  </Link>
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-sm text-ink-2">
                  {STATUS_LABELS[h.status] ?? h.status}
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-sm text-ink-2">{fullName(primary)}</td>
                <td className="whitespace-nowrap px-6 py-4 text-sm text-ink-2">{fullName(spouse)}</td>
                <td className="whitespace-nowrap px-6 py-4 text-sm text-ink-3">
                  {updated.toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

import Link from "next/link";
import type { OpenItemRow } from "@/lib/overview/list-open-items";

export default function OpenItemsPreview({
  clientId,
  items,
  totalOpen,
  totalCompleted,
}: {
  clientId: string;
  items: OpenItemRow[];
  totalOpen: number;
  totalCompleted: number;
}) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-950 p-6">
      <h3 className="mb-3 text-sm font-semibold text-gray-300">Open items</h3>
      {items.length === 0 ? (
        <p className="text-sm text-gray-400">
          No open items.{" "}
          <Link href={`/clients/${clientId}/client-data`} className="text-blue-400 underline">
            Add on Details
          </Link>
        </p>
      ) : (
        <ul className="space-y-1">
          {items.map((i) => (
            <li key={i.id} className="flex items-center gap-2 text-sm">
              <span aria-hidden>☐</span>
              <span className="flex-1 text-gray-200">{i.title}</span>
              <span className="text-xs text-gray-500">{i.priority}</span>
              {i.dueDate && <span className="text-xs text-gray-500">{i.dueDate}</span>}
            </li>
          ))}
        </ul>
      )}
      <Link
        href={`/clients/${clientId}/client-data`}
        className="mt-3 block text-sm text-blue-400 underline"
      >
        {totalOpen} open · {totalCompleted} completed → Manage
      </Link>
    </div>
  );
}

import { listOpenItems } from "@/lib/overview/list-open-items";
import OpenItemsList from "./open-items-list";

export default async function OpenItemsPanel({
  clientId,
  firmId,
}: {
  clientId: string;
  firmId: string;
}) {
  const rows = await listOpenItems(clientId, firmId, { open: false, limit: 200 });
  const items = rows.map((r) => ({
    id: r.id,
    title: r.title,
    priority: r.priority,
    dueDate: r.dueDate,
    completedAt: r.completedAt ? new Date(r.completedAt).toISOString() : null,
  }));
  return (
    <section className="mt-8 rounded-lg border border-gray-800 bg-gray-950 p-6">
      <OpenItemsList clientId={clientId} items={items} />
    </section>
  );
}

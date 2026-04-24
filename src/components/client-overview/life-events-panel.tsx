import Link from "next/link";

type Event = { year: number; label: string };

export default function LifeEventsPanel({
  clientId,
  events,
}: {
  clientId: string;
  events: Event[];
}) {
  if (!events.length) {
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-950 p-6">
        <h3 className="mb-2 text-sm font-semibold text-gray-300">Life events</h3>
        <p className="text-sm text-gray-400">Add a retirement year to populate.</p>
        <Link href={`/clients/${clientId}/client-data`} className="text-sm text-blue-400 underline">
          Edit client details
        </Link>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-950 p-6">
      <h3 className="mb-3 text-sm font-semibold text-gray-300">Life events</h3>
      <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {events.slice(0, 10).map((e, i) => (
          <li key={i} className="text-sm text-gray-300">
            <Link href={`/clients/${clientId}/timeline#y${e.year}`} className="hover:text-gray-100">
              <span className="font-mono text-gray-500">{e.year}</span>
              <span className="mx-2 text-gray-700">·</span>
              {e.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

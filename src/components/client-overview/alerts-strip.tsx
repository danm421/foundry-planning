import Link from "next/link";
import type { Alert } from "@/lib/alerts";

const CHIP: Record<Alert["severity"], string> = {
  warning: "border-yellow-700 bg-yellow-950/40 text-yellow-200",
  critical: "border-red-700 bg-red-950/40 text-red-200",
};

export default function AlertsStrip({ alerts }: { alerts: Alert[] }) {
  if (alerts.length === 0) {
    return (
      <div className="rounded-lg border border-emerald-800 bg-emerald-950/30 p-4 text-sm text-emerald-300">
        All clear
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-950 p-4">
      <h3 className="mb-2 text-sm font-semibold text-gray-300">Alerts</h3>
      <ul className="space-y-2">
        {alerts.map((a) => (
          <li key={a.id} className={`rounded border p-2 text-sm ${CHIP[a.severity]}`}>
            {a.href ? (
              <Link href={a.href} className="block">
                <p className="font-medium">{a.title}</p>
                <p className="text-xs opacity-80">{a.detail}</p>
              </Link>
            ) : (
              <>
                <p className="font-medium">{a.title}</p>
                <p className="text-xs opacity-80">{a.detail}</p>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

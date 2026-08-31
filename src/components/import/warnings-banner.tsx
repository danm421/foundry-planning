// src/components/import/warnings-banner.tsx
export default function WarningsBanner({ warnings }: { warnings: string[] }) {
  if (!warnings || warnings.length === 0) return null;
  return (
    <div
      role="status"
      className="rounded border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn"
    >
      <ul className="list-disc space-y-1 pl-4">
        {warnings.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
    </div>
  );
}

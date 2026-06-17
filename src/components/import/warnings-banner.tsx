// src/components/import/warnings-banner.tsx
export default function WarningsBanner({ warnings }: { warnings: string[] }) {
  if (!warnings || warnings.length === 0) return null;
  return (
    <div
      role="status"
      className="rounded border border-amber-700/50 bg-amber-900/20 px-3 py-2 text-sm text-amber-200"
    >
      <ul className="list-disc space-y-1 pl-4">
        {warnings.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
    </div>
  );
}

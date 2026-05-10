export function TimelineTick({ label, year }: { label: string; year: number }) {
  return (
    <div className="flex items-center gap-2 my-3">
      <span className="h-2 w-2 rounded-full bg-ink-3" />
      <span className="text-[10.5px] uppercase tracking-wider text-ink-3">{label}</span>
      <span className="text-[14px] tabular-nums">{year}</span>
      <hr className="flex-1 border-hair" />
    </div>
  );
}

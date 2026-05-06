export function InspectorToggle({ label, value, onChange }: {
  label: string; value: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between text-[13px] text-ink">
      <span>{label}</span>
      <button
        type="button" onClick={() => onChange(!value)}
        className={`relative h-5 w-9 rounded-full transition ${value ? "bg-accent" : "bg-card-2 border border-hair"}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-paper transition ${value ? "left-[18px]" : "left-0.5"}`} />
      </button>
    </label>
  );
}

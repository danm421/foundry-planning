import { fieldLabelClassName } from "@/components/forms/input-styles";

export function InspectorTextarea({ label, value, onChange, rows = 4 }: {
  label: string; value: string; onChange: (v: string) => void; rows?: number;
}) {
  return (
    <div>
      <label className={fieldLabelClassName}>{label}</label>
      <textarea
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-[var(--radius-sm)] bg-card-2 border border-hair px-3 py-2 text-[14px] focus:border-accent focus:ring-2 focus:ring-accent/25"
      />
    </div>
  );
}

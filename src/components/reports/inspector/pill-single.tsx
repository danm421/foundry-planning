import { fieldLabelClassName } from "@/components/forms/input-styles";

export function InspectorPillSingle<T extends string>({ label, value, onChange, options }: {
  label: string; value: T; onChange: (v: T) => void;
  options: readonly { value: T; label: string }[];
}) {
  return (
    <div>
      <label className={fieldLabelClassName}>{label}</label>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.value} type="button" onClick={() => onChange(o.value)}
            className={`h-7 px-2.5 rounded-full text-[12px] border transition ${
              value === o.value ? "bg-accent text-paper border-accent" : "bg-card-2 text-ink-3 border-hair hover:border-ink-3"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

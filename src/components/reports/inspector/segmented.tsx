import { fieldLabelClassName } from "@/components/forms/input-styles";

export function InspectorSegmented<T extends string>({ label, value, onChange, options }: {
  label: string; value: T; onChange: (v: T) => void;
  options: readonly { value: T; label: string }[];
}) {
  return (
    <div>
      <label className={fieldLabelClassName}>{label}</label>
      <div className="inline-flex bg-card-2 border border-hair rounded-md p-0.5">
        {options.map((o) => (
          <button
            key={o.value} type="button" onClick={() => onChange(o.value)}
            className={`h-7 px-3 text-[12px] rounded ${
              value === o.value ? "bg-card text-ink" : "text-ink-3 hover:text-ink"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

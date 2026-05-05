import { selectClassName, fieldLabelClassName } from "@/components/forms/input-styles";

export function InspectorSelect<T extends string>({ label, value, onChange, options }: {
  label: string; value: T; onChange: (v: T) => void;
  options: readonly { value: T; label: string }[];
}) {
  return (
    <div>
      <label className={fieldLabelClassName}>{label}</label>
      <select className={selectClassName} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

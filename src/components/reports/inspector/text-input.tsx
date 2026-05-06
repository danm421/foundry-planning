import { inputClassName, fieldLabelClassName } from "@/components/forms/input-styles";

export function InspectorTextInput({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div>
      <label className={fieldLabelClassName}>{label}</label>
      <input className={inputClassName} value={value} placeholder={placeholder}
             onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

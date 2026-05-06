import { fieldLabelClassName, inputClassName } from "@/components/forms/input-styles";
import type { YearRange } from "@/lib/reports/types";
import { useReportContext } from "@/components/reports/builder-context";
import { resolveYearRange } from "@/lib/reports/year-range-default";

export function InspectorYearRange({ label, value, onChange }: {
  label: string; value: YearRange; onChange: (v: YearRange) => void;
}) {
  const ctx = useReportContext();
  const resolved = resolveYearRange(value, ctx.household);
  const span = resolved.to - resolved.from;
  return (
    <div>
      <label className={fieldLabelClassName}>{label}</label>
      <div className="flex items-center gap-2">
        <input className={inputClassName + " w-24"} type="number"
               value={resolved.from} onChange={(e) => onChange({ ...value, from: Number(e.target.value) })} />
        <span className="text-ink-3">→</span>
        <input className={inputClassName + " w-24"} type="number"
               value={resolved.to} onChange={(e) => onChange({ ...value, to: Number(e.target.value) })} />
        <span className="text-[11px] font-mono text-ink-3 ml-auto">{span} yrs</span>
      </div>
    </div>
  );
}

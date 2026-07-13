import { FieldTooltip } from "foundry-planning";
import type { ReactNode } from "react";

function Canvas({ children }: { children: ReactNode }) {
  return <div className="bg-paper text-ink font-sans p-6">{children}</div>;
}

const fieldClass =
  "h-9 w-full rounded border border-hair bg-card-2 px-3 text-[13px] text-ink outline-none tabular";

function Field({
  label,
  tip,
  value,
}: {
  label: string;
  tip: string;
  value: string;
}) {
  return (
    <div>
      <label className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-ink-2">
        {label}
        <FieldTooltip text={tip} />
      </label>
      <input readOnly className={fieldClass} defaultValue={value} />
    </div>
  );
}

/**
 * Resting composition. FieldTooltip reveals its floating panel only on CSS
 * :hover / :focus-within of the badge, so a static screenshot shows the badge
 * at rest next to each label — the honest render.
 */
export function InLabel() {
  return (
    <Canvas>
      <div className="w-[360px] space-y-4 rounded-[var(--radius)] border border-hair bg-card p-5">
        <h3 className="text-[14px] font-semibold text-ink">Withdrawal assumptions</h3>
        <Field
          label="Safe withdrawal rate"
          tip="The share of the portfolio drawn in year one, then inflation-adjusted every year after."
          value="4.0%"
        />
        <Field
          label="Effective tax rate"
          tip="Blended federal and state rate applied to taxable withdrawals in retirement."
          value="22%"
        />
        <p className="text-[12px] text-ink-3">
          Each ? opens a short explanation of how the input is used.
        </p>
      </div>
    </Canvas>
  );
}

import { CurrencyInput } from "foundry-planning";
import type { ReactNode } from "react";

function Canvas({ children }: { children: ReactNode }) {
  return (
    <div className="bg-paper text-ink font-sans p-6" style={{ width: 320 }}>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="block mb-1.5 text-[13px] font-medium text-ink-2">{label}</label>
      {children}
    </div>
  );
}

export function Default() {
  return (
    <Canvas>
      <Field label="Current balance">
        <CurrencyInput name="balance" defaultValue={1284500} />
      </Field>
    </Canvas>
  );
}

export function Empty() {
  return (
    <Canvas>
      <Field label="Annual contribution">
        <CurrencyInput name="contribution" placeholder="0" />
      </Field>
    </Canvas>
  );
}

export function Negative() {
  return (
    <Canvas>
      <Field label="Monthly cash flow">
        <CurrencyInput name="cashflow" defaultValue={-1240} />
      </Field>
    </Canvas>
  );
}

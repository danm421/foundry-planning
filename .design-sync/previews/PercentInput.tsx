import { PercentInput } from "foundry-planning";
import type { ReactNode } from "react";

function Canvas({ children }: { children: ReactNode }) {
  return (
    <div className="bg-paper text-ink font-sans p-6" style={{ width: 280 }}>
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
      <Field label="Expected growth rate">
        <PercentInput name="growth" defaultValue="6.5" />
      </Field>
    </Canvas>
  );
}

export function Empty() {
  return (
    <Canvas>
      <Field label="Employer match cap">
        <PercentInput name="matchCap" placeholder="0.00" />
      </Field>
    </Canvas>
  );
}

export function ManyDecimals() {
  return (
    <Canvas>
      <Field label="Blended portfolio return">
        <PercentInput name="blended" defaultValue="6.7423" decimals={4} />
      </Field>
    </Canvas>
  );
}

import { StateSelect } from "foundry-planning";
import { useState, type ReactNode } from "react";

function Canvas({ children }: { children: ReactNode }) {
  return (
    <div className="bg-paper text-ink font-sans p-6" style={{ width: 280 }}>
      {children}
    </div>
  );
}

function Field({ children }: { children: ReactNode }) {
  return (
    <div>
      <label className="block mb-1.5 text-[13px] font-medium text-ink-2">
        State of residence
      </label>
      {children}
    </div>
  );
}

export function Selected() {
  const [value, setValue] = useState("CA");
  return (
    <Canvas>
      <Field>
        <StateSelect id="state" name="state" value={value} onChange={setValue} required />
      </Field>
    </Canvas>
  );
}

export function Placeholder() {
  const [value, setValue] = useState("");
  return (
    <Canvas>
      <Field>
        <StateSelect id="state-2" name="state" value={value} onChange={setValue} />
      </Field>
    </Canvas>
  );
}

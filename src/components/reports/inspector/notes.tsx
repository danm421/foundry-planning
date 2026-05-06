import { InspectorTextarea } from "./textarea";
import { InspectorSection } from "./section";

export function InspectorNotes({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <InspectorSection eyebrow="D · Notes (advisor only, not exported)">
      <InspectorTextarea label="" value={value} onChange={onChange} rows={4} />
    </InspectorSection>
  );
}

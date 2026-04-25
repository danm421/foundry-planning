import type { ReactElement } from "react";
import type { FieldChange } from "@/lib/audit";
import { formatDiffValue } from "@/lib/activity/format-helpers";

interface Props {
  changes: FieldChange[];
}

export default function UpdateRowBody({ changes }: Props): ReactElement {
  return (
    <ul className="flex flex-col gap-0.5 text-sm text-ink">
      {changes.map((change) => (
        <li key={change.field}>
          <span className="text-ink-3">{change.label}: </span>
          <span>{formatDiffValue(change.from, change.format)}</span>
          <span className="text-ink-3"> → </span>
          <span>{formatDiffValue(change.to, change.format)}</span>
        </li>
      ))}
    </ul>
  );
}

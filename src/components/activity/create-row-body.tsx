import type { ReactElement } from "react";
import type { EntitySnapshot } from "@/lib/audit";
import { humanizeFieldName } from "@/lib/audit/labels";
import { formatDiffValue } from "@/lib/activity/format-helpers";
import { getFieldLabels } from "./field-label-registry";

interface Props {
  snapshot: EntitySnapshot;
  resourceType: string;
}

export default function CreateRowBody({ snapshot, resourceType }: Props): ReactElement {
  return <SnapshotList snapshot={snapshot} resourceType={resourceType} />;
}

export function SnapshotList({
  snapshot,
  resourceType,
  initiallyShown = 4,
}: Props & { initiallyShown?: number }): ReactElement {
  const labels = getFieldLabels(resourceType);
  const entries = Object.entries(snapshot);
  const shown = entries.slice(0, initiallyShown);
  const hiddenCount = entries.length - shown.length;

  return (
    <div className="text-sm text-ink">
      <ul className="flex flex-col gap-0.5">
        {shown.map(([field, value]) => {
          const desc = labels[field] ?? { label: humanizeFieldName(field), format: "text" as const };
          return (
            <li key={field}>
              <span className="text-ink-3">{desc.label}: </span>
              <span>{formatDiffValue(value, desc.format)}</span>
            </li>
          );
        })}
      </ul>
      {hiddenCount > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer text-xs text-ink-3 hover:text-ink">
            Show {hiddenCount} more {hiddenCount === 1 ? "field" : "fields"}
          </summary>
          <ul className="mt-1 flex flex-col gap-0.5">
            {entries.slice(initiallyShown).map(([field, value]) => {
              const desc = labels[field] ?? { label: humanizeFieldName(field), format: "text" as const };
              return (
                <li key={field}>
                  <span className="text-ink-3">{desc.label}: </span>
                  <span>{formatDiffValue(value, desc.format)}</span>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </div>
  );
}


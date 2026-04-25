import type { ReactElement } from "react";
import type { AuditMetadata } from "@/lib/audit";

interface Props {
  metadata: AuditMetadata | null;
}

export default function OtherRowBody({ metadata }: Props): ReactElement | null {
  if (!metadata || metadata.kind !== "other") return null;
  return (
    <div className="text-sm text-ink-3">
      {metadata.note && <p>{metadata.note}</p>}
    </div>
  );
}

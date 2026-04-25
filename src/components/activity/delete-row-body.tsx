import type { ReactElement } from "react";
import type { EntitySnapshot } from "@/lib/audit";
import { SnapshotList } from "./create-row-body";

interface Props {
  snapshot: EntitySnapshot;
  resourceType: string;
}

export default function DeleteRowBody({ snapshot, resourceType }: Props): ReactElement {
  return <SnapshotList snapshot={snapshot} resourceType={resourceType} />;
}

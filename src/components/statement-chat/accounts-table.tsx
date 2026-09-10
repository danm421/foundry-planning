"use client";

import type { ExtractedAccount } from "@/lib/extraction/types";
import type { Annotated } from "@/lib/imports/types";
import EntityTable from "./entity-table";
import type { ExcludedRow } from "./excluded-rows";
import { ACCOUNT_COLUMNS } from "./accounts-columns";

type Row = Annotated<ExtractedAccount>;

export interface AccountsTableProps {
  rows: Row[];
  excluded: ExcludedRow<Row>[];
  committedRowIds: string[];
  onCommitRows: (rowIds: string[]) => Promise<void>;
  onEditCell: (rowId: string, field: string, value: unknown) => void;
}

/**
 * Task 10's public surface, unchanged by the controller amendment's 3-file
 * split — a thin wrapper over the generic `EntityTable` with the accounts
 * column spec applied. Phase 2 adds sibling `<entity>-table.tsx` wrappers
 * the same way, each supplying its own column spec.
 */
export default function AccountsTable(props: AccountsTableProps) {
  return <EntityTable columns={ACCOUNT_COLUMNS} {...props} />;
}

"use client";
import type { ReactElement } from "react";
import type { VaultFolder } from "./use-portal-vault";
import { PencilIcon } from "@/components/portal/portal-icons";
import { VaultRowMenu } from "./vault-row-menu";
import { FolderIcon, ChevronRightIcon, TrashIcon } from "./vault-icons";

export function VaultFolderRow({
  folder,
  editEnabled,
  onOpen,
  onRename,
  onDelete,
}: {
  folder: VaultFolder;
  editEnabled: boolean;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}): ReactElement {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-card-2 text-accent">
          <FolderIcon width={18} height={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium text-ink">{folder.name}</span>
          <span className="block text-[12px] text-ink-4">Folder</span>
        </span>
        <ChevronRightIcon width={16} height={16} className="shrink-0 text-ink-4" />
      </button>
      {editEnabled && (
        <VaultRowMenu
          label={`Actions for ${folder.name}`}
          items={[
            { key: "rename", label: "Rename", icon: <PencilIcon width={15} height={15} />, onSelect: onRename },
            { key: "delete", label: "Delete", icon: <TrashIcon width={15} height={15} />, onSelect: onDelete, destructive: true },
          ]}
        />
      )}
    </div>
  );
}

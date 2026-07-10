"use client";
import type { ReactElement } from "react";
import type { VaultDoc } from "./use-portal-vault";
import { PencilIcon } from "@/components/portal/portal-icons";
import { VaultRowMenu } from "./vault-row-menu";
import { FileGlyph, DownloadIcon, MoveIcon, TrashIcon } from "./vault-icons";
import { fileKind, formatBytes, formatDocDate, type FileKind } from "./vault-format";

// Tasteful per-type tint for the file glyph, using the Deep Jewel data tokens as
// inline CSS vars (they are not registered as Tailwind color utilities, so
// `text-data-*` would render no CSS — mirror category-combobox's inline approach).
const KIND_COLOR: Record<FileKind, string | undefined> = {
  image: "var(--data-teal)",
  pdf: "var(--data-red)",
  sheet: "var(--data-green)",
  doc: "var(--data-blue)",
  file: undefined,
};

export function VaultFileRow({
  doc,
  editEnabled,
  downloading,
  onDownload,
  onRename,
  onMove,
  onDelete,
}: {
  doc: VaultDoc;
  editEnabled: boolean;
  downloading: boolean;
  onDownload: () => void;
  onRename: () => void;
  onMove: () => void;
  onDelete: () => void;
}): ReactElement {
  const kind = fileKind(doc.mimeType, doc.filename);
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
      <button
        type="button"
        onClick={onDownload}
        disabled={downloading}
        title={`Download ${doc.filename}`}
        className="group flex min-w-0 flex-1 items-center gap-3 text-left disabled:opacity-60"
      >
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-card-2 text-ink-3"
          style={KIND_COLOR[kind] ? { color: KIND_COLOR[kind] } : undefined}
        >
          <FileGlyph kind={kind} width={18} height={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium text-ink group-hover:text-accent-ink">
            {doc.filename}
          </span>
          <span className="tabular block text-[12px] text-ink-4">
            {formatBytes(doc.sizeBytes)} · {formatDocDate(doc.createdAt)}
          </span>
        </span>
        <span className="shrink-0 text-ink-4 group-hover:text-ink-2" aria-hidden="true">
          <DownloadIcon width={16} height={16} />
        </span>
      </button>
      {editEnabled && (
        <VaultRowMenu
          label={`Actions for ${doc.filename}`}
          items={[
            { key: "rename", label: "Rename", icon: <PencilIcon width={15} height={15} />, onSelect: onRename },
            { key: "move", label: "Move to…", icon: <MoveIcon width={15} height={15} />, onSelect: onMove },
            { key: "delete", label: "Delete", icon: <TrashIcon width={15} height={15} />, onSelect: onDelete, destructive: true },
          ]}
        />
      )}
    </div>
  );
}

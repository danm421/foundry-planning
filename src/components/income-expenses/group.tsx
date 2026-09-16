"use client";

function PlusMiniIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
    </svg>
  );
}

export function AddGroupButton({ onClick, label = "Add" }: { onClick: () => void; label?: string }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-card-hover text-ink-3 hover:bg-accent/15 hover:text-accent"
      aria-label={label}
      title={label}
    >
      <PlusMiniIcon />
    </button>
  );
}

function Group({
  label,
  total,
  onAdd,
  children,
}: {
  label: string;
  total: string;
  onAdd?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-hair last:border-0">
      <div className="flex items-center justify-between bg-card-2 px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-ink-3">{label}</span>
          {onAdd && <AddGroupButton onClick={onAdd} label={`Add to ${label}`} />}
        </div>
        <span className="text-xs text-ink-3">{total}</span>
      </div>
      <div className="divide-y divide-hair">{children}</div>
    </div>
  );
}

export default Group;

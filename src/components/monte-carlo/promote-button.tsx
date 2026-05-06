interface PromoteButtonProps {
  onPromote: () => void;
  label?: string;
}

export function PromoteButton({ onPromote, label = "View as main chart" }: PromoteButtonProps) {
  return (
    <button
      type="button"
      onClick={onPromote}
      title={label}
      aria-label={label}
      className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-emerald-300 transition-colors"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4"
        aria-hidden="true"
      >
        <path d="M15 3h6v6" />
        <path d="M9 21H3v-6" />
        <path d="M21 3l-7 7" />
        <path d="M3 21l7-7" />
      </svg>
    </button>
  );
}

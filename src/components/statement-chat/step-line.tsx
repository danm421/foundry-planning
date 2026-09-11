/**
 * One row in the extraction progress list rendered by `chat-surface.tsx`.
 *
 * `file` events do NOT arrive in upload order — extraction runs several
 * files concurrently, so whichever settles first renders first. Each row
 * only ever describes the file it's given; ordering is the caller's concern.
 */
export interface StepLineProps {
  fileName: string;
  /** Present once the file has settled (success or failure). Absent while
   *  still in flight — rendered as a quiet "reading…" row. */
  accountCount?: number;
  statementDate?: string;
  /** Present only when this file failed to extract. */
  error?: string;
}

function usDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${m}/${d}/${y}`;
}

export function StepLine({ fileName, accountCount, statementDate, error }: StepLineProps) {
  const settled = accountCount !== undefined || error !== undefined;

  return (
    <div className="flex items-start gap-2.5 py-1.5 text-sm">
      <span className="mt-0.5 shrink-0">
        {error ? <ErrorIcon /> : settled ? <DoneIcon /> : <PendingIcon />}
      </span>
      <div className="min-w-0 flex-1">
        <span className="truncate font-medium text-ink">{fileName}</span>
        {error ? (
          <p className="text-crit">{error}</p>
        ) : settled ? (
          <p className="text-ink-3">
            <span className="tabular">{accountCount}</span>{" "}
            {accountCount === 1 ? "account" : "accounts"}
            {statementDate ? (
              <>
                {" "}
                as of <span className="tabular">{usDate(statementDate)}</span>
              </>
            ) : null}
          </p>
        ) : (
          <p className="text-ink-3">Reading…</p>
        )}
      </div>
    </div>
  );
}

function DoneIcon() {
  return (
    <svg
      className="h-4 w-4 text-good"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.5 2.5 2.5 5-5" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg
      className="h-4 w-4 text-crit"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5" />
      <path d="M12 16.5v.01" />
    </svg>
  );
}

function PendingIcon() {
  return (
    <svg
      className="h-4 w-4 animate-spin text-ink-3 motion-reduce:animate-none"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" />
    </svg>
  );
}

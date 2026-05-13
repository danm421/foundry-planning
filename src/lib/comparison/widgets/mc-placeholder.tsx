import type { McRunView } from "./types";

interface Props {
  title: string;
  mcRun: McRunView;
}

export function McPlaceholder({ title, mcRun }: Props) {
  const isError = mcRun.status === "error";
  const isLoading = mcRun.status === "loading" || mcRun.status === "idle";

  const message = isError
    ? "Couldn't run the Monte Carlo simulation."
    : mcRun.phase === "running" && mcRun.total
      ? `Running ${(mcRun.total).toLocaleString("en-US")} trials… ${Math.min(100, Math.round(((mcRun.done ?? 0) / mcRun.total) * 100))}%`
      : "Running Monte Carlo simulation…";

  return (
    <section className="px-6 py-8">
      <h2 className="mb-4 text-lg font-semibold text-slate-100">{title}</h2>
      <div
        role="status"
        aria-live="polite"
        className={`flex h-72 flex-col items-center justify-center gap-3 rounded border bg-slate-900 text-sm ${
          isError ? "border-rose-700/60 text-rose-200" : "border-slate-800 text-slate-300"
        }`}
      >
        {isLoading && (
          <svg
            className="h-6 w-6 animate-spin text-slate-400"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
            <path
              d="M22 12a10 10 0 0 1-10 10"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </svg>
        )}
        <p className="text-center">{message}</p>
        {isError && mcRun.error && (
          <p className="max-w-md px-4 text-center text-xs text-rose-300/80">{mcRun.error}</p>
        )}
        {isError && (
          <button
            type="button"
            onClick={mcRun.retry}
            className="mt-1 rounded border border-rose-400/60 bg-rose-400/10 px-3 py-1 text-xs font-medium text-rose-100 hover:bg-rose-400/20"
          >
            Retry
          </button>
        )}
        {!isError && (
          <button
            type="button"
            onClick={mcRun.retry}
            className="mt-1 rounded border border-slate-700 px-3 py-1 text-xs text-slate-400 hover:border-slate-500 hover:text-slate-200"
          >
            Force reload
          </button>
        )}
      </div>
    </section>
  );
}

interface ReportHeaderProps {
  clientDisplayName: string;
  onRestart: () => void;
  running: boolean;
}

export function ReportHeader({ clientDisplayName, onRestart, running }: ReportHeaderProps) {
  return (
    <header className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-slate-100">
          Monte Carlo Simulation: Retirement Forecast
        </h1>
        <p className="text-sm text-slate-400">Client: {clientDisplayName}</p>
      </div>
      <div className="flex gap-2">
        <button
          onClick={onRestart}
          disabled={running}
          className="rounded border border-slate-700 bg-slate-900/60 px-3 py-1.5 text-sm text-slate-200 hover:border-emerald-400/60 hover:text-emerald-300 disabled:opacity-50"
          title="Re-run with a new random seed"
        >
          {running ? "Running…" : "New Seed"}
        </button>
        <button
          type="button"
          disabled
          title="Coming soon"
          className="rounded bg-emerald-500/20 ring-1 ring-emerald-400/40 px-3 py-1.5 text-sm text-emerald-300 opacity-60 cursor-not-allowed"
        >
          View Scenario
        </button>
      </div>
    </header>
  );
}

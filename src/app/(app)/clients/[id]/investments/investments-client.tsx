"use client";

interface Props {
  clientId: string;
}

export default function InvestmentsClient({ clientId: _clientId }: Props) {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <nav className="mb-1 text-xs uppercase tracking-wide text-gray-500">
            Reports / Investments / Asset Allocation
          </nav>
          <h2 className="text-xl font-bold uppercase tracking-wide text-gray-100">
            Asset Allocation Report
          </h2>
        </div>
        <div className="text-sm text-gray-400">Target Portfolio: —</div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.1fr_1fr]">
        <section className="rounded-lg border border-gray-700 bg-gray-900 p-4">
          <h3 className="mb-3 text-sm font-semibold text-gray-300">Allocation Details</h3>
          <div className="text-xs text-gray-500">Loading…</div>
        </section>

        <section className="rounded-lg border border-gray-700 bg-gray-900 p-4">
          <h3 className="mb-3 text-sm font-semibold text-gray-300">Portfolio</h3>
          <div className="text-xs text-gray-500">Loading…</div>
        </section>

        <section className="rounded-lg border border-gray-700 bg-gray-900 p-4">
          <h3 className="mb-3 text-sm font-semibold text-gray-300">Drift vs Target</h3>
          <div className="text-xs text-gray-500">Loading…</div>
        </section>
      </div>

      <div className="flex items-center justify-between border-t border-gray-800 pt-4">
        <div className="flex gap-2">
          <button
            className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700"
            disabled
          >
            Download PDF
          </button>
          <button
            className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700"
            disabled
          >
            Advisor Comment
          </button>
        </div>
      </div>
    </div>
  );
}

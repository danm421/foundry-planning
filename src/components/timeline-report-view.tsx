"use client";

interface TimelineReportViewProps {
  clientId: string;
}

export default function TimelineReportView({ clientId }: TimelineReportViewProps) {
  return (
    <div className="rounded border border-gray-700 bg-gray-900 p-6 text-gray-200">
      <h2 className="text-lg font-semibold text-gray-100">Timeline</h2>
      <p className="mt-2 text-sm text-gray-400">
        Timeline report coming soon. Client ID: <span className="font-mono">{clientId}</span>
      </p>
    </div>
  );
}

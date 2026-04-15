"use client";

export type FileStatus = "queued" | "extracting" | "done" | "error";

export interface FileProgress {
  id: string;
  fileName: string;
  status: FileStatus;
  error?: string;
}

interface ExtractionProgressProps {
  files: FileProgress[];
  onRetry?: (id: string) => void;
}

export default function ExtractionProgress({ files, onRetry }: ExtractionProgressProps) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-gray-300">Extracting documents...</h3>
      {files.map((f) => (
        <div
          key={f.id}
          className="flex items-center gap-3 rounded-md border border-gray-700 bg-gray-900 px-3 py-2"
        >
          <StatusIndicator status={f.status} />
          <span className="min-w-0 flex-1 truncate text-sm text-gray-200">{f.fileName}</span>
          {f.status === "error" && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-red-400">{f.error ?? "Failed"}</span>
              {onRetry && (
                <button
                  onClick={() => onRetry(f.id)}
                  className="rounded px-2 py-0.5 text-xs text-blue-400 hover:bg-gray-800"
                >
                  Retry
                </button>
              )}
            </div>
          )}
          {f.status === "done" && (
            <CheckIcon />
          )}
        </div>
      ))}
    </div>
  );
}

function StatusIndicator({ status }: { status: FileStatus }) {
  if (status === "extracting") {
    return (
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-600 border-t-blue-400" />
    );
  }
  if (status === "done") {
    return <div className="h-4 w-4 rounded-full bg-green-500" />;
  }
  if (status === "error") {
    return <div className="h-4 w-4 rounded-full bg-red-500" />;
  }
  return <div className="h-4 w-4 rounded-full bg-gray-600" />;
}

function CheckIcon() {
  return (
    <svg className="h-4 w-4 text-green-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

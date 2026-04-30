"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/card";
import UploadZone from "@/components/import/upload-zone";
import type { ImportPayload } from "@/lib/imports/types";

export interface ImportFlowFile {
  id: string;
  originalFilename: string;
  documentType: string;
  sizeBytes: number;
  uploadedAt: string;
}

interface ImportFlowProps {
  clientId: string;
  importId: string;
  mode: "onboarding" | "updating";
  status: "draft" | "extracting" | "review" | "committed";
  scenarioId: string | null;
  notes: string | null;
  files: ImportFlowFile[];
  payload: ImportPayload | null;
  perTabCommittedAt: Record<string, string> | null;
}

const MODE_LABEL: Record<string, string> = {
  onboarding: "Onboarding",
  updating: "Updating",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  extracting: "Extracting",
  review: "Review",
  committed: "Committed",
};

const STATUS_TONE: Record<string, string> = {
  draft: "bg-card-2 text-ink-3",
  extracting: "bg-cat-life/20 text-cat-life",
  review: "bg-cat-portfolio/20 text-cat-portfolio",
  committed: "bg-good/20 text-good",
};

export default function ImportFlow(props: ImportFlowProps) {
  const { clientId, status, mode } = props;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href={`/clients/${clientId}/client-data/import`}
            className="text-sm text-ink-3 underline-offset-2 hover:underline"
          >
            ← Imports
          </Link>
          <h1 className="text-xl font-semibold text-ink">
            {MODE_LABEL[mode] ?? mode}
          </h1>
          <span
            className={`rounded px-2 py-0.5 text-xs font-medium ${
              STATUS_TONE[status] ?? "bg-card-2 text-ink-3"
            }`}
          >
            {STATUS_LABEL[status] ?? status}
          </span>
        </div>
      </div>

      {status === "draft" ? <DraftStage {...props} /> : null}
      {status === "extracting" ? <ExtractingStage {...props} /> : null}
      {status === "review" ? <ReviewStage {...props} /> : null}
      {status === "committed" ? <CommittedStage {...props} /> : null}
    </div>
  );
}

function DraftStage(props: ImportFlowProps) {
  const router = useRouter();
  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-2">
          Upload documents
        </h2>
      </CardHeader>
      <CardBody>
        <UploadZone
          clientId={props.clientId}
          importId={props.importId}
          onUploaded={() => router.refresh()}
        />
        {props.files.length > 0 ? (
          <div className="mt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">
              Uploaded ({props.files.length})
            </h3>
            <ul className="mt-2 flex flex-col gap-1 text-sm text-ink-2">
              {props.files.map((f) => (
                <li
                  key={f.id}
                  className="flex items-center justify-between border-b border-hair py-1 last:border-0"
                >
                  <span className="truncate">{f.originalFilename}</span>
                  <span className="font-mono text-xs text-ink-4">
                    {f.documentType}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function ExtractingStage(props: ImportFlowProps) {
  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-2">
          Extracting
        </h2>
      </CardHeader>
      <CardBody>
        <p className="text-sm text-ink-3">
          Extraction progress with sub-progress polling is wired in Task 8.5.
          Refresh this page to check status.
        </p>
        <p className="mt-2 text-sm text-ink-3">
          {props.files.length} file{props.files.length === 1 ? "" : "s"} queued.
        </p>
      </CardBody>
    </Card>
  );
}

function ReviewStage(props: ImportFlowProps) {
  const counts = props.payload
    ? {
        accounts: props.payload.accounts.length,
        incomes: props.payload.incomes.length,
        expenses: props.payload.expenses.length,
        liabilities: props.payload.liabilities.length,
        lifePolicies: props.payload.lifePolicies.length,
        wills: props.payload.wills.length,
        entities: props.payload.entities.length,
        dependents: props.payload.dependents.length,
      }
    : null;

  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-2">
          Review
        </h2>
      </CardHeader>
      <CardBody>
        <p className="text-sm text-ink-3">
          Review wizard with partial-commit tabs is wired in Task 8.9.
        </p>
        {counts ? (
          <ul className="mt-3 grid grid-cols-2 gap-2 text-sm text-ink-2 md:grid-cols-4">
            {Object.entries(counts).map(([k, v]) => (
              <li
                key={k}
                className="flex items-baseline gap-2 border-b border-hair pb-1"
              >
                <span className="text-xs uppercase tracking-wide text-ink-3">
                  {k}
                </span>
                <span className="font-mono text-base text-ink">{v}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-ink-4">No payload available yet.</p>
        )}
      </CardBody>
    </Card>
  );
}

function CommittedStage(props: ImportFlowProps) {
  const tabs = props.perTabCommittedAt
    ? Object.entries(props.perTabCommittedAt)
    : [];

  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-2">
          Committed
        </h2>
      </CardHeader>
      <CardBody>
        <p className="text-sm text-ink-3">
          This import has been committed. Read-only summary below.
        </p>
        {tabs.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-1 text-sm">
            {tabs.map(([tab, ts]) => (
              <li
                key={tab}
                className="flex justify-between border-b border-hair py-1 last:border-0"
              >
                <span className="text-ink-2">{tab}</span>
                <span className="font-mono text-xs text-ink-4">
                  {new Date(ts).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </CardBody>
    </Card>
  );
}

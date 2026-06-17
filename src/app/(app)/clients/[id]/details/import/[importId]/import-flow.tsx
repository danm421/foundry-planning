"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, CardBody, CardHeader } from "@/components/card";
import UploadZone from "@/components/import/upload-zone";
import ExtractionProgress from "@/components/import/extraction-progress";
import ReviewWizard from "@/components/import/review-wizard";
import type { ImportPayload } from "@/lib/imports/types";
import type { GrowthContext } from "@/lib/investments/growth-context";
import { draftErrorMessage } from "@/lib/imports/draft-error-message";

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
  growthContext: GrowthContext;
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
            href={`/clients/${clientId}/details/import`}
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
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extractHoldings, setExtractHoldings] = useState(false);

  const startExtraction = async () => {
    setExtracting(true);
    setExtractError(null);
    try {
      const res = await fetch(
        `/api/clients/${props.clientId}/imports/${props.importId}/extract`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: "mini", extractHoldings }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setExtractError(body.error ?? `Extraction failed (${res.status})`);
        setExtracting(false);
        return;
      }
      // Route is synchronous: it returns { succeeded, failed, status }.
      // If status stayed "draft", every file failed — reset the button
      // and surface the count so the user knows to check the server log.
      const body = (await res.json().catch(() => ({}))) as {
        succeeded?: number;
        failed?: number;
        status?: string;
        warnings?: string[];
      };
      if (body.status === "draft") {
        setExtractError(draftErrorMessage(body, props.files.length));
        setExtracting(false);
        return;
      }
      // Extraction wrote raw fileResults to payloadJson but the wizard
      // reads the annotated payload. Chain the matching pass so the
      // wizard sees data on first render — without this the user lands
      // on "No annotated payload available. Re-run extraction."
      const matchRes = await fetch(
        `/api/clients/${props.clientId}/imports/${props.importId}/match`,
        { method: "POST" },
      );
      if (!matchRes.ok) {
        const matchBody = (await matchRes.json().catch(() => ({}))) as {
          error?: string;
        };
        setExtractError(
          matchBody.error ?? `Matching failed (${matchRes.status})`,
        );
        setExtracting(false);
        return;
      }
      router.refresh();
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : "Extraction failed");
      setExtracting(false);
    }
  };

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
          initialFiles={props.files.map((f) => ({
            serverFileId: f.id,
            name: f.originalFilename,
            documentType: f.documentType,
          }))}
          onUploaded={() => router.refresh()}
          onRemoved={() => router.refresh()}
          disabled={extracting}
        />
        {props.files.length > 0 ? (
          <div className="mt-4 flex flex-col gap-2 border-t border-hair pt-4">
            <label className="flex items-center gap-2 text-xs text-ink-2">
              <input
                type="checkbox"
                checked={extractHoldings}
                onChange={(e) => setExtractHoldings(e.target.checked)}
                className="h-4 w-4 rounded border-hair accent-accent"
              />
              Extract individual holdings from statements
            </label>
            <p className="text-[11px] text-ink-4">
              Pulls each position&apos;s ticker, shares, and cost basis from brokerage statements. Bonds, untickered funds, and cash are saved with the values shown on the statement.
            </p>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-ink-3">
                Extraction runs synchronously and may take 30–60 seconds per file.
              </p>
              <button
                type="button"
                onClick={startExtraction}
                disabled={extracting}
                className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-on disabled:cursor-not-allowed disabled:opacity-60"
              >
                {extracting ? "Extracting…" : "Start extraction"}
              </button>
            </div>
            {extractError ? (
              <p className="text-xs text-bad">{extractError}</p>
            ) : null}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function ExtractingStage(props: ImportFlowProps) {
  const router = useRouter();
  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-2">
          Extracting
        </h2>
      </CardHeader>
      <CardBody>
        <ExtractionProgress
          clientId={props.clientId}
          importId={props.importId}
          onTerminal={() => router.refresh()}
        />
      </CardBody>
    </Card>
  );
}

function ReviewStage(props: ImportFlowProps) {
  if (!props.payload) {
    return (
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-2">
            Review
          </h2>
        </CardHeader>
        <CardBody>
          <p className="text-sm text-ink-4">
            No annotated payload available. Re-run extraction.
          </p>
        </CardBody>
      </Card>
    );
  }

  const currentYear = new Date().getFullYear();
  const fileNames = Object.fromEntries(
    props.files.map((f) => [f.id, f.originalFilename]),
  );

  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-2">
          Review
        </h2>
      </CardHeader>
      <CardBody>
        <ReviewWizard
          clientId={props.clientId}
          importId={props.importId}
          payload={props.payload}
          perTabCommittedAt={props.perTabCommittedAt}
          defaultStartYear={currentYear}
          defaultEndYear={currentYear + 30}
          growthContext={props.growthContext}
          fileNames={fileNames}
        />
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

"use client";

import { useEffect, useRef, useState } from "react";
import DialogShell from "@/components/dialog-shell";
import { CheckIcon, CopyIcon, UploadIcon } from "@/components/icons";
import { FieldTooltip } from "./field-tooltip";
import { normalizeExtractedHolding } from "@/lib/extraction/normalize-holdings";
import {
  HOLDINGS_IMPORT_COLUMNS,
  HOLDINGS_IMPORT_HEADER_ROW,
  type HoldingsImportMode,
  type HoldingsImportSource,
  type ImportHolding,
  type StatementAccount,
  type StatementRead,
} from "@/lib/investments/holdings-import";
import {
  importHoldings,
  readHoldingsSpreadsheet,
  readHoldingsStatement,
} from "@/lib/investments/holdings-client";

/** Choosing a file, choosing one of a statement's accounts, or reviewing the
 *  positions about to be saved. A statement's `read` rides along so Back can
 *  return to the account list without paying for a second AI read. */
type Step =
  | { kind: "pick" }
  | { kind: "account"; read: StatementRead }
  | { kind: "review"; rows: ImportHolding[]; statement?: { read: StatementRead; account: StatementAccount } };

interface Props {
  clientId: string;
  accountId: string;
  /** Positions already on the account — asks replace-or-add when there are any. */
  existingCount: number;
  /** Fired after a successful import; the parent re-lists and closes. */
  onImported: () => void;
  onClose: () => void;
}

const SOURCES: { id: HoldingsImportSource; label: string }[] = [
  { id: "spreadsheet", label: "Spreadsheet" },
  { id: "statement", label: "Statement" },
];

const ACCEPT: Record<HoldingsImportSource, string> = {
  spreadsheet: ".xlsx,.csv",
  statement: ".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.csv",
};

const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const amount = (n: number | undefined, digits: number) =>
  n == null ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: digits });

/** A position's value as the file states it (cash at $1 a unit, as saved);
 *  undefined for a ticker with shares but no price, which import prices live. */
const statedValue = (h: ImportHolding) => normalizeExtractedHolding(h).marketValue;

function messageOf(e: unknown): string {
  const message = e instanceof Error ? e.message : "Something went wrong. Please try again.";
  // The entitlement refusal carries a machine code, not prose.
  return message === "ai_import_not_entitled" ? "AI features aren't enabled for this firm." : message;
}

const TH = "sticky top-0 z-10 border-b border-hair bg-card-2 px-2 py-2 font-medium";

export function HoldingsImportDialog({ clientId, accountId, existingCount, onImported, onClose }: Props) {
  const [source, setSource] = useState<HoldingsImportSource>("spreadsheet");
  const [step, setStep] = useState<Step>({ kind: "pick" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [mode, setMode] = useState<HoldingsImportMode>("replace");
  const fileInput = useRef<HTMLInputElement>(null);

  function clearMessages() {
    setError(null);
    setWarnings([]);
  }

  function reviewAccount(read: StatementRead, index: number) {
    const account = read.accounts[index];
    setStep({ kind: "review", rows: account.holdings, statement: { read, account } });
  }

  async function handleFile(file: File) {
    setBusy(true);
    clearMessages();
    try {
      if (source === "spreadsheet") {
        const read = await readHoldingsSpreadsheet(clientId, accountId, file);
        setWarnings(read.warnings);
        if (read.holdings.length === 0) setError("No positions were found in that file.");
        else setStep({ kind: "review", rows: read.holdings });
      } else {
        const read = await readHoldingsStatement(clientId, accountId, file);
        setWarnings(read.warnings);
        if (read.accounts.length === 0) setError("No positions could be read off that statement.");
        else if (read.accounts.length === 1) reviewAccount(read, 0);
        else if (read.matchIndex != null) reviewAccount(read, read.matchIndex);
        else setStep({ kind: "account", read });
      }
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function handleImport(rows: ImportHolding[]) {
    setBusy(true);
    setError(null);
    try {
      await importHoldings(clientId, accountId, { source, mode, holdings: rows });
      onImported();
    } catch (e) {
      setError(messageOf(e));
      setBusy(false);
    }
  }

  function back() {
    const read = step.kind === "review" ? step.statement?.read : undefined;
    if (read && read.accounts.length > 1) {
      setError(null); // the read's own warnings still apply to the list
      setStep({ kind: "account", read });
    } else {
      clearMessages();
      setStep({ kind: "pick" });
    }
  }

  const close = () => { if (!busy) onClose(); };
  const reviewing = step.kind === "review" ? step : null;

  return (
    <DialogShell
      open
      onOpenChange={(next) => { if (!next) close(); }}
      title="Import holdings"
      size="lg"
      primaryAction={
        reviewing
          ? {
              label: `Import ${reviewing.rows.length} ${reviewing.rows.length === 1 ? "holding" : "holdings"}`,
              onClick: () => handleImport(reviewing.rows),
              disabled: reviewing.rows.length === 0,
              loading: busy,
            }
          : undefined
      }
      secondaryAction={
        step.kind === "pick"
          ? { label: "Cancel", onClick: close, disabled: busy }
          : { label: "Back", onClick: back, disabled: busy }
      }
    >
      <div className="space-y-4">
        {step.kind === "pick" && (
          <>
            <div className="inline-flex gap-1.5" role="group" aria-label="Import from">
              {SOURCES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={source === s.id}
                  disabled={busy}
                  onClick={() => { setSource(s.id); clearMessages(); }}
                  className={`rounded-[var(--radius-sm)] border px-3 py-1.5 text-[13px] font-medium transition-colors ${
                    source === s.id
                      ? "border-accent bg-accent/20 text-accent-ink"
                      : "border-hair bg-card-2 text-ink-2 hover:border-hair-2"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {source === "spreadsheet" ? (
              <div className="space-y-3">
                <p className="flex items-center gap-1.5 text-sm text-ink-2">
                  Upload an Excel or CSV file with one row per position, under these column headers.
                  <FieldTooltip
                    text={
                      <>
                        Each row needs a Ticker or a Name, and Shares or a Market Value. Price and Cost Basis
                        are optional — any ticker Foundry recognizes is priced at today&apos;s market close.
                        Column order doesn&apos;t matter, extra columns are ignored, and custodian exports
                        (Symbol, Quantity, Current Value…) are read as-is.
                      </>
                    }
                  />
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex overflow-hidden rounded-[var(--radius-sm)] border border-hair text-xs text-ink-2">
                    {HOLDINGS_IMPORT_COLUMNS.map((c) => (
                      <span key={c.field} className="border-r border-hair bg-card-2 px-2.5 py-1.5 font-medium last:border-r-0">
                        {c.header}
                      </span>
                    ))}
                  </div>
                  <CopyHeadersButton />
                </div>
              </div>
            ) : (
              <p className="text-sm text-ink-2">
                Upload a custodian statement — a PDF or a photo. Foundry reads its positions, and you review
                them before anything is saved.
              </p>
            )}

            <div className="flex items-center gap-3">
              <input
                ref={fileInput}
                type="file"
                accept={ACCEPT[source]}
                className="hidden"
                aria-hidden
                tabIndex={-1}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                }}
              />
              <button
                type="button"
                data-autofocus=""
                onClick={() => fileInput.current?.click()}
                disabled={busy}
                className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 text-[13px] font-medium text-ink-2 transition-colors hover:border-hair-2 hover:text-ink disabled:opacity-60"
              >
                <UploadIcon width={14} height={14} aria-hidden="true" />
                {source === "spreadsheet" ? "Choose spreadsheet" : "Choose statement"}
              </button>
              <span className="text-sm text-ink-3" aria-live="polite">
                {busy && (source === "spreadsheet" ? "Reading…" : "Reading the statement — this can take a minute…")}
              </span>
            </div>
          </>
        )}

        {step.kind === "account" && (
          <div className="space-y-2">
            <p className="text-sm text-ink-2">
              That statement holds {step.read.accounts.length} accounts. Pick the one to import.
            </p>
            <ul className="divide-y divide-hair rounded-md border border-hair">
              {step.read.accounts.map((a, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => reviewAccount(step.read, i)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-card-hover"
                  >
                    <span className="text-ink">
                      {a.name}
                      {a.last4 && <span className="tabular ml-2 text-ink-3">····{a.last4}</span>}
                    </span>
                    <span className="tabular shrink-0 text-ink-3">
                      {a.holdings.length} positions · {money(a.holdings.reduce((s, h) => s + (statedValue(h) ?? 0), 0))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {reviewing && (
          <ReviewTable
            rows={reviewing.rows}
            from={reviewing.statement?.account}
            onRemove={(index) =>
              setStep({ ...reviewing, rows: reviewing.rows.filter((_, i) => i !== index) })
            }
          />
        )}

        {reviewing && existingCount > 0 && (
          <fieldset className="space-y-1.5 text-sm text-ink-2">
            <legend className="mb-1.5 text-ink">
              This account already has {existingCount} {existingCount === 1 ? "holding" : "holdings"}.
            </legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="holdings-import-mode" className="accent-accent"
                checked={mode === "replace"} onChange={() => setMode("replace")} />
              Replace them with these
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="holdings-import-mode" className="accent-accent"
                checked={mode === "append"} onChange={() => setMode("append")} />
              Add these alongside them
            </label>
          </fieldset>
        )}

        {error && (
          <p role="alert" className="rounded-md border border-crit/40 bg-crit/10 px-3 py-2 text-sm text-crit">
            {error}
          </p>
        )}
        {warnings.length > 0 && (
          <ul className="max-h-28 space-y-0.5 overflow-y-auto text-xs text-warn">
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        )}
      </div>
    </DialogShell>
  );
}

function ReviewTable({
  rows, from, onRemove,
}: {
  rows: ImportHolding[];
  /** The statement account the rows came off, when they came off a statement. */
  from?: StatementAccount;
  onRemove: (index: number) => void;
}) {
  const values = rows.map(statedValue);
  const total = values.reduce<number>((s, v) => s + (v ?? 0), 0);
  const unpriced = values.filter((v) => v == null).length;

  return (
    <div className="space-y-2">
      <p className="text-sm text-ink-2">
        {from && <>From <span className="text-ink">{from.name}</span>{from.last4 && <span className="tabular"> ····{from.last4}</span>} · </>}
        <span className="tabular">{rows.length}</span> {rows.length === 1 ? "position" : "positions"} ·{" "}
        <span className="tabular text-ink">{money(total)}</span>
        {unpriced > 0 && <> + <span className="tabular">{unpriced}</span> priced on import</>}
      </p>
      <div className="max-h-[min(42vh,320px)] overflow-auto rounded-md border border-hair">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-ink-3">
            <tr>
              <th className={`${TH} text-left`}>Ticker</th>
              <th className={`${TH} text-left`}>Name</th>
              <th className={`${TH} text-right`}>Shares</th>
              <th className={`${TH} text-right`}>
                <span className="inline-flex items-center justify-end gap-1">
                  Price
                  <FieldTooltip
                    side="bottom"
                    text="The file's price. Any ticker Foundry recognizes is repriced at today's market close when you import."
                  />
                </span>
              </th>
              <th className={`${TH} text-right`}>Market value</th>
              <th className={`${TH} text-right`}>Cost basis</th>
              <th className={TH}><span className="sr-only">Remove</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hair text-ink-2">
            {rows.map((h, i) => (
              <tr key={i}>
                <td className="whitespace-nowrap px-2 py-1.5 font-medium text-ink">{h.ticker ?? "—"}</td>
                <td className="max-w-[16rem] truncate px-2 py-1.5" title={h.name}>{h.name ?? ""}</td>
                <td className="tabular px-2 py-1.5 text-right">{amount(h.shares, 4)}</td>
                <td className="tabular px-2 py-1.5 text-right">{h.price == null ? "—" : `$${amount(h.price, 4)}`}</td>
                <td className="tabular px-2 py-1.5 text-right">{values[i] == null ? "—" : money(values[i]!)}</td>
                <td className="tabular px-2 py-1.5 text-right">{h.costBasis == null ? "—" : money(h.costBasis)}</td>
                <td className="px-2 py-1.5 text-right">
                  <button
                    type="button"
                    onClick={() => onRemove(i)}
                    aria-label={`Leave out ${h.ticker ?? h.name ?? "this position"}`}
                    className="text-ink-4 hover:text-crit"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const COPIED_MS = 1500;

/** "Copy headers": the template's header row, tab-separated for a paste into Excel. */
function CopyHeadersButton() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(HOLDINGS_IMPORT_HEADER_ROW);
    } catch {
      return; // no clipboard (insecure context, denied permission)
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  }

  const Icon = copied ? CheckIcon : CopyIcon;
  return (
    <button
      type="button"
      onClick={copy}
      className={`inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-hair bg-card-2 px-2.5 text-[12px] font-medium transition-colors hover:border-hair-2 hover:text-ink ${
        copied ? "text-good" : "text-ink-2"
      }`}
    >
      <Icon width={13} height={13} aria-hidden="true" />
      <span aria-live="polite">{copied ? "Copied — paste into row 1" : "Copy headers"}</span>
    </button>
  );
}

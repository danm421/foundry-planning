"use client";

import { useRef, useState, useTransition } from "react";

export type AssetResult = { ok: true; url: string } | { ok: false; error: string };
export type RemoveResult = { ok: true; noop?: true } | { ok: false; error: string };
export type SaveResult = { ok: true } | { ok: false; error: string };

/** The server actions take a `FormData` (so they can be called as plain
 *  server actions from a client component); every `AssetCard` caller needs
 *  this same one-line wrap around the `File` the card hands back. */
export function toFileFormData(file: File): FormData {
  const fd = new FormData();
  fd.set("file", file);
  return fd;
}

/**
 * Logo/favicon upload card. Framework-agnostic: it takes handler props
 * instead of importing a server action directly, so the same card renders
 * both the firm form (`./actions`) and the advisor form (`./advisor-actions`)
 * — see `branding-form.tsx` and `advisor-brand-form.tsx`.
 */
export function AssetCard({
  label,
  helper,
  accept,
  initialUrl,
  previewClass,
  onUpload,
  onRemove,
}: {
  label: string;
  helper: string;
  accept: string;
  initialUrl: string | null;
  previewClass: string;
  onUpload: (file: File) => Promise<AssetResult>;
  onRemove: () => Promise<RemoveResult>;
}) {
  const [url, setUrl] = useState<string | null>(initialUrl);
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    startTransition(async () => {
      const result = await onUpload(file);
      if (!result.ok) {
        setToast(result.error);
        return;
      }
      setUrl(result.url);
      setToast("Saved");
    });
  }

  function handleRemove() {
    startTransition(async () => {
      const result = await onRemove();
      if (!result.ok) {
        setToast(result.error);
        return;
      }
      setUrl(null);
      setToast(result.noop ? "Nothing to remove" : "Removed");
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded border border-hair p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-ink">{label}</h2>
        {toast ? <span className="text-xs text-ink-3">{toast}</span> : null}
      </div>
      <div className="flex items-center gap-4">
        <div className="flex h-20 min-w-[120px] items-center justify-center rounded border border-dashed border-hair bg-paper px-3">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={`${label} preview`} className={previewClass} />
          ) : (
            <span className="text-xs text-ink-4">No {label.toLowerCase()}</span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            className="hidden"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              if (file) handleFile(file);
              e.currentTarget.value = "";
            }}
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => inputRef.current?.click()}
              className="rounded bg-ink px-3 py-1.5 text-sm text-paper disabled:opacity-50"
            >
              {pending ? "Saving…" : url ? "Replace" : "Upload"}
            </button>
            {url ? (
              <button
                type="button"
                disabled={pending}
                onClick={handleRemove}
                className="rounded border border-hair px-3 py-1.5 text-sm text-ink-3 hover:text-ink disabled:opacity-50"
              >
                Remove
              </button>
            ) : null}
          </div>
          <p className="text-xs text-ink-4">{helper}</p>
        </div>
      </div>
    </section>
  );
}

/** Firm primary-color picker. Not reused by the advisor form — the advisor's
 *  `primaryColor` is one of eight fields batched into one PUT (see
 *  `advisor-brand-form.tsx`), not a standalone save-per-field card. */
export function ColorCard({
  initial,
  onSave,
}: {
  initial: string | null;
  onSave: (value: string | null) => Promise<SaveResult>;
}) {
  const [savedValue, setSavedValue] = useState(initial ?? "");
  const [value, setValue] = useState(initial ?? "");
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<string | null>(null);
  const dirty = savedValue !== value;
  const swatch = /^#[0-9a-f]{6}$/i.test(value) ? value : null;

  function handleSave() {
    const next = value === "" ? null : value;
    startTransition(async () => {
      const result = await onSave(next);
      if (!result.ok) {
        setToast(result.error);
        return;
      }
      setSavedValue(value);
      setToast("Saved");
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded border border-hair p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-ink">Primary color</h2>
        {toast ? <span className="text-xs text-ink-3">{toast}</span> : null}
      </div>
      <div className="flex items-center gap-3">
        <span
          className="inline-block h-8 w-8 rounded border border-hair"
          style={{ backgroundColor: swatch ?? "transparent" }}
          aria-hidden
        />
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          // eslint-disable-next-line brand/no-raw-hex -- instructional UI: placeholder shows the expected hex format to the user
          placeholder="#0a2bff"
          maxLength={7}
          className="w-32 rounded border border-hair bg-paper px-3 py-2 font-mono text-sm text-ink"
        />
        <button
          type="button"
          disabled={!dirty || pending}
          onClick={handleSave}
          className="rounded bg-ink px-3 py-1.5 text-sm text-paper disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      <p className="text-xs text-ink-4">6-digit hex like <span className="font-mono">#0a2bff</span>. Leave blank to clear.</p>
    </section>
  );
}

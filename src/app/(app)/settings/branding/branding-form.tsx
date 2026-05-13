"use client";

import { useRef, useState, useTransition } from "react";
import {
  uploadBrandingAsset,
  removeBrandingAsset,
  setPrimaryColorAction,
} from "./actions";

type Initial = {
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string | null;
};

export default function BrandingForm({ initial }: { initial: Initial }) {
  return (
    <div className="flex flex-col gap-6">
      <AssetCard
        kind="logo"
        label="Logo"
        helper="PNG, JPEG, or WebP. Up to 2 MB."
        accept="image/png,image/jpeg,image/webp"
        initialUrl={initial.logoUrl}
        previewClass="h-16 w-auto max-w-[240px] object-contain"
      />
      <AssetCard
        kind="favicon"
        label="Favicon"
        helper="PNG. Up to 256 KB. Square (e.g. 32×32 or 64×64) recommended."
        accept="image/png"
        initialUrl={initial.faviconUrl}
        previewClass="h-8 w-8 object-contain"
      />
      <ColorCard initial={initial.primaryColor} />
    </div>
  );
}

function AssetCard({
  kind,
  label,
  helper,
  accept,
  initialUrl,
  previewClass,
}: {
  kind: "logo" | "favicon";
  label: string;
  helper: string;
  accept: string;
  initialUrl: string | null;
  previewClass: string;
}) {
  const [url, setUrl] = useState<string | null>(initialUrl);
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    const fd = new FormData();
    fd.set("file", file);
    startTransition(async () => {
      const result = await uploadBrandingAsset(kind, fd);
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
      const result = await removeBrandingAsset(kind);
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

function ColorCard({ initial }: { initial: string | null }) {
  const [value, setValue] = useState(initial ?? "");
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<string | null>(null);
  const dirty = (initial ?? "") !== value;
  const swatch = /^#[0-9a-f]{6}$/i.test(value) ? value : null;

  function handleSave() {
    const next = value === "" ? null : value;
    startTransition(async () => {
      const result = await setPrimaryColorAction(next);
      if (!result.ok) {
        setToast(result.error);
        return;
      }
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

"use client";

import { useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent } from "react";
import DialogShell from "./dialog-shell";
import {
  MAX_SCREENSHOTS,
  MAX_SCREENSHOT_BYTES,
  ALLOWED_SCREENSHOT_TYPES,
} from "@/lib/feedback/schema";

export type Mode = "support" | "feedback";
type FeedbackType = "bug" | "feature";

interface Props {
  mode: Mode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const RESET_DELAY_MS = 200;

const TITLES: Record<Mode, string> = {
  support: "Contact support",
  feedback: "Report a bug or request a feature",
};

export default function FeedbackSupportDialog({ mode, open, onOpenChange }: Props) {
  const [subject, setSubject] = useState("");
  const [type, setType] = useState<FeedbackType>("bug");
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function reset() {
    setSubject("");
    setType("bug");
    setMessage("");
    setFiles([]);
    setError(null);
    setSending(false);
    setSent(false);
  }

  function close() {
    onOpenChange(false);
    setTimeout(reset, RESET_DELAY_MS);
  }

  function addFiles(incoming: File[]) {
    setError(null);
    const images = incoming.filter((f) =>
      (ALLOWED_SCREENSHOT_TYPES as readonly string[]).includes(f.type),
    );
    if (images.length !== incoming.length) {
      setError("Only PNG, JPG, or WebP images.");
    }
    const tooBig = images.find((f) => f.size > MAX_SCREENSHOT_BYTES);
    if (tooBig) {
      setError(`${tooBig.name} exceeds 5 MB.`);
      return;
    }
    const overflow = files.length + images.length > MAX_SCREENSHOTS;
    setFiles((prev) => [...prev, ...images].slice(0, MAX_SCREENSHOTS));
    if (overflow) setError(`At most ${MAX_SCREENSHOTS} screenshots.`);
  }

  function onPickFiles(e: ChangeEvent<HTMLInputElement>) {
    addFiles(Array.from(e.target.files ?? []));
    e.target.value = "";
  }
  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    addFiles(Array.from(e.dataTransfer.files));
  }
  function onPaste(e: ClipboardEvent<HTMLDivElement>) {
    const pasted = Array.from(e.clipboardData.files);
    if (pasted.length) addFiles(pasted);
  }

  async function submit() {
    if (!message.trim()) {
      setError("Please add a message.");
      return;
    }
    if (mode === "support" && !subject.trim()) {
      setError("Please add a subject.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("mode", mode);
      fd.set("message", message);
      fd.set("pageUrl", typeof window !== "undefined" ? window.location.href : "");
      if (mode === "support") fd.set("subject", subject);
      if (mode === "feedback") {
        fd.set("type", type);
        for (const f of files) fd.append("screenshots", f);
      }
      const res = await fetch("/api/feedback", { method: "POST", body: fd });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Something went wrong.");
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSending(false);
    }
  }

  const labelCls = "block text-[12px] font-medium text-ink-2 mb-1";
  const inputCls =
    "w-full rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-2 text-[13px] text-ink outline-none focus:border-accent";

  return (
    <DialogShell
      open={open}
      onOpenChange={close}
      title={TITLES[mode]}
      size="sm"
      primaryAction={
        sent
          ? undefined
          : { label: "Send", onClick: submit, loading: sending, disabled: sending }
      }
      secondaryAction={{ label: sent ? "Close" : "Cancel", onClick: close }}
    >
      {sent ? (
        <p className="py-6 text-center text-[14px] text-ink-2">
          Thanks — we got your message and will follow up by email.
        </p>
      ) : (
        <div className="flex flex-col gap-4" onPaste={onPaste}>
          {mode === "feedback" && (
            <div role="group" aria-label="Type" className="flex gap-2">
              {(["bug", "feature"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={type === t}
                  onClick={() => setType(t)}
                  className={`flex-1 rounded-[var(--radius-sm)] border px-3 py-2 text-[13px] ${
                    type === t
                      ? "border-accent text-accent bg-card-2"
                      : "border-hair text-ink-2 hover:bg-card-2"
                  }`}
                >
                  {t === "bug" ? "🐞 Bug" : "✨ Feature request"}
                </button>
              ))}
            </div>
          )}

          {mode === "support" && (
            <div>
              <label htmlFor="fb-subject" className={labelCls}>
                Subject
              </label>
              <input
                id="fb-subject"
                className={inputCls}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
          )}

          <div>
            <label htmlFor="fb-message" className={labelCls}>
              Message
            </label>
            <textarea
              id="fb-message"
              rows={6}
              className={`${inputCls} resize-y`}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>

          {mode === "feedback" && (
            <div>
              <span className={labelCls}>Screenshots (optional)</span>
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={onDrop}
                className="rounded-[var(--radius-sm)] border border-dashed border-hair px-3 py-4 text-center text-[12px] text-ink-3"
              >
                Drag & drop, paste, or{" "}
                <button
                  type="button"
                  className="text-accent underline"
                  onClick={() => fileInputRef.current?.click()}
                >
                  choose files
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ALLOWED_SCREENSHOT_TYPES.join(",")}
                  multiple
                  className="hidden"
                  onChange={onPickFiles}
                />
              </div>
              {files.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1">
                  {files.map((f, i) => (
                    <li
                      key={`${f.name}-${i}`}
                      className="flex items-center justify-between text-[12px] text-ink-2"
                    >
                      <span className="truncate">{f.name}</span>
                      <button
                        type="button"
                        className="text-ink-3 hover:text-crit"
                        onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}
                        aria-label={`Remove ${f.name}`}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {error && <p className="text-[12px] text-crit">{error}</p>}
        </div>
      )}
    </DialogShell>
  );
}

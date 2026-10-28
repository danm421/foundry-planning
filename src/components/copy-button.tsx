"use client";

import { useEffect, useRef, useState } from "react";
import { CheckIcon, CopyIcon } from "@/components/icons";

const COPIED_MS = 1500;

/** Icon-only copy-to-clipboard button; shows a check for a beat after a copy. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // No clipboard (insecure context, denied permission) — leave the icon as-is.
      return;
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
      aria-label={`Copy ${label}`}
      title={copied ? "Copied" : `Copy ${label}`}
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[var(--radius-sm)] transition-colors duration-150 hover:text-ink focus-visible:text-ink ${
        copied ? "text-good" : "text-ink-4"
      }`}
    >
      <Icon width={12} height={12} aria-hidden="true" />
      <span className="sr-only" aria-live="polite">
        {copied ? "Copied" : ""}
      </span>
    </button>
  );
}

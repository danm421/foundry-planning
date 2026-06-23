"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EMAIL_RE } from "@/lib/intake/schema";

export default function SendProspectForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!EMAIL_RE.test(email)) {
      setError("Please enter a valid email address.");
      return;
    }

    setSending(true);
    try {
      const res = await fetch("/api/data-collection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "blank", recipientName: name, recipientEmail: email }),
      });

      if (res.status === 429) {
        setError("Rate limit reached. Please try again later.");
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error ?? "Failed to send intake form.");
        return;
      }

      setName("");
      setEmail("");
      setSuccess(true);
      router.refresh();
      setTimeout(() => setSuccess(false), 4000);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-[var(--radius-sm)] border border-hair bg-card p-5">
      <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-4">
        Send to prospect
      </h2>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="prospect-name" className="block mb-1 text-[12px] text-ink-3">
            Name
          </label>
          <input
            id="prospect-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jane Smith"
            className="w-full rounded-[var(--radius-sm)] border border-hair bg-paper px-3 py-2 text-[14px] text-ink outline-none focus:border-accent"
          />
        </div>
        <div className="flex-1">
          <label htmlFor="prospect-email" className="block mb-1 text-[12px] text-ink-3">
            Email <span aria-hidden="true">*</span>
          </label>
          <input
            id="prospect-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jane@example.com"
            className="w-full rounded-[var(--radius-sm)] border border-hair bg-paper px-3 py-2 text-[14px] text-ink outline-none focus:border-accent"
          />
        </div>
        <button
          type="submit"
          disabled={sending}
          className="btn-primary shrink-0 rounded-[var(--radius-sm)] bg-accent px-5 py-2 text-[14px] font-medium text-accent-on transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-2 text-[13px] text-red-600">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="mt-2 text-[13px] text-green-700">
          Intake form sent.
        </p>
      )}
    </div>
  );
}

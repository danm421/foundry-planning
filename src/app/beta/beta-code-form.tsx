"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { validateAndStash } from "./actions";

export function BetaCodeForm({ initialCode }: { initialCode: string }) {
  const router = useRouter();
  const [code, setCode] = useState(initialCode);
  const [firmName, setFirmName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await validateAndStash(code, firmName);
    if (!res.ok) {
      setError(res.error);
      setPending(false);
      return;
    }
    router.push("/beta/signup");
  }

  return (
    <form onSubmit={onSubmit} className="mt-7 flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-[var(--color-ink-2)]">Beta code</span>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="FNDR-XXXX-XXXX"
          autoComplete="off"
          className="rounded-md border border-[var(--color-hair-2)] bg-[var(--color-card)] px-3 py-2 font-mono uppercase tracking-wide text-[var(--color-ink)] focus:border-[var(--color-accent)] focus:outline-none"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-[var(--color-ink-2)]">Firm name</span>
        <input
          value={firmName}
          onChange={(e) => setFirmName(e.target.value)}
          placeholder="Acme Wealth Advisors"
          className="rounded-md border border-[var(--color-hair-2)] bg-[var(--color-card)] px-3 py-2 text-[var(--color-ink)] focus:border-[var(--color-accent)] focus:outline-none"
        />
      </label>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="mt-1 rounded-md bg-[var(--color-accent)] px-4 py-2 font-semibold text-[var(--color-accent-on)] transition-colors hover:bg-[var(--color-accent-ink)] disabled:opacity-60"
      >
        {pending ? "Checking…" : "Continue"}
      </button>
    </form>
  );
}

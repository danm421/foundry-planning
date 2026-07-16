"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useOrganizationList } from "@clerk/nextjs";
import { redeemBetaCode } from "./actions";
import { LANDING_PATH } from "@/lib/routes";

export function RedeemRunner() {
  const { isLoaded, setActive } = useOrganizationList();
  const router = useRouter();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [code, setCode] = useState("");
  const [firmName, setFirmName] = useState("");
  const [pending, setPending] = useState(true);

  async function run(input?: { code: string; firmName: string }) {
    setPending(true);
    setError(null);
    const res = await redeemBetaCode(input);
    if (!res.ok) {
      setError(res.error);
      if (res.needsManualEntry) setManual(true);
      setPending(false);
      return;
    }
    if (!setActive) {
      setError("Could not activate your firm. Refresh and try again.");
      setPending(false);
      return;
    }
    try {
      await setActive({ organization: res.orgId });
    } catch (err) {
      console.error("[beta-redeem] setActive failed:", err);
      setError("Could not activate your firm. Refresh and try again.");
      setPending(false);
      return;
    }
    router.push(LANDING_PATH);
  }

  // Auto-attempt once from the cookie when Clerk is ready.
  useEffect(() => {
    if (!isLoaded || started.current) return;
    started.current = true;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded]);

  if (pending && !manual) {
    return <p className="mt-7 text-sm text-[var(--color-ink-2)]">Setting up your firm…</p>;
  }

  return (
    <form
      className="mt-7 flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void run({ code, firmName });
      }}
    >
      {error && <p className="text-sm text-red-400">{error}</p>}
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
      <button
        type="submit"
        disabled={pending}
        className="mt-1 rounded-md bg-[var(--color-accent)] px-4 py-2 font-semibold text-[var(--color-accent-on)] transition-colors hover:bg-[var(--color-accent-ink)] disabled:opacity-60"
      >
        {pending ? "Setting up…" : "Finish setup"}
      </button>
    </form>
  );
}

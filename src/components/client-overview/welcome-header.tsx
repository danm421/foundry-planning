import type { ReactElement } from "react";

interface Props {
  /** Household / client display name. */
  name: string;
  /** Last time the record changed — drives the "Updated …" stamp. */
  updatedAt: Date | string;
}

const STOPWORDS = new Set(["the", "household", "family", "trust", "and"]);

/** Up to two initials, skipping filler words like "The" / "Household". */
function initials(name: string): string {
  const all = name.trim().split(/\s+/).filter(Boolean);
  const words = all.filter((w) => !STOPWORDS.has(w.toLowerCase()) && /[a-z]/i.test(w));
  const src = words.length ? words : all;
  const letters = src.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
  return letters || "—";
}

const fmtDate = (d: Date | string): string =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(typeof d === "string" ? new Date(d) : d);

/**
 * The first thing an advisor sees on opening a client — leads with the human,
 * not a metric. A quiet monogram, the household name closed with the signature
 * verdigris period, and a mono "Updated …" stamp.
 */
export default function WelcomeHeader({ name, updatedAt }: Props): ReactElement {
  return (
    <header className="flex items-center gap-4">
      <span
        aria-hidden
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-hair bg-card-2 font-mono text-[15px] font-semibold tracking-tight text-ink-2"
      >
        {initials(name)}
      </span>
      <div className="flex flex-col gap-1">
        <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.015em] text-ink">
          {name}
          <span className="text-accent">.</span>
        </h1>
        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-4">
          Household overview · Updated {fmtDate(updatedAt)}
        </p>
      </div>
    </header>
  );
}

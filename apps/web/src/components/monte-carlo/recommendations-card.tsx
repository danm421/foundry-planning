// Inline SVG sparkle — lucide-react is not installed in this repo; adding a
// dep for a single icon isn't worth it. If lucide later lands in package.json,
// swap this for <Sparkles />.
function SparkleIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3l1.8 4.7L18 9l-4.2 1.3L12 15l-1.8-4.7L6 9l4.2-1.3L12 3z" />
      <path d="M19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14z" />
    </svg>
  );
}

export function RecommendationsCard() {
  return (
    <section className="rounded-lg bg-slate-900/60 ring-1 ring-slate-800 p-4 relative min-h-[140px]">
      <h3 className="text-sm font-semibold text-slate-100 mb-2">Recommendations</h3>
      {/* TODO: advisor-generated content */}
      <p className="text-sm text-slate-300">AI-generated recommendations coming soon.</p>
      <p className="text-[12px] text-slate-500 mt-1">
        Advisor insights will appear here based on your plan&apos;s risk profile.
      </p>
      <div className="absolute bottom-3 right-3 text-emerald-300/70">
        <SparkleIcon />
      </div>
    </section>
  );
}

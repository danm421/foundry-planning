// src/components/copilot/spark-icon.tsx

/**
 * The Copilot "AI sparkle" glyph. Shared by the panel (header + empty state)
 * and the floating launcher so the AI mark stays identical everywhere; size is
 * controlled via className (defaults to the panel's inline size). Pure SVG — no
 * hooks, so it renders in either a server or client tree.
 */
export function SparkIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path
        d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.4 2.4M15.3 15.3l2.4 2.4M17.7 6.3l-2.4 2.4M8.7 15.3l-2.4 2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

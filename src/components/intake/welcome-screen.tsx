"use client";

interface WelcomeScreenProps {
  mode: "blank" | "prefilled";
  onStart: () => void;
}

const SECTIONS = [
  {
    key: "family",
    label: "Family",
    description: "Who the plan covers — you, a spouse, and any dependents.",
  },
  {
    key: "assets",
    label: "Assets",
    description: "Investment accounts, income sources, and property you own.",
  },
  {
    key: "goals",
    label: "Goals",
    description: "When you want to retire and what retirement should cost.",
  },
  {
    key: "review",
    label: "Review",
    description: "Confirm everything looks right before submitting to your advisor.",
  },
] as const;

export function WelcomeScreen({ mode, onStart }: WelcomeScreenProps) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      {/* Header */}
      <div className="mb-10 text-center">
        <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">
          {mode === "prefilled" ? "Update your information" : "Get started"}
        </p>
        <h1 className="mb-3 text-[32px] font-semibold leading-[1.15] tracking-[-0.025em] text-ink">
          Welcome<span className="text-accent">.</span>
        </h1>
        <p className="mx-auto max-w-md text-[15px] leading-[1.55] text-ink-2">
          {mode === "prefilled"
            ? "Review and update the information your advisor has on file. Changes save automatically as you go."
            : "This short form gives your advisor what they need to build a plan calibrated to your situation. Most people finish in under ten minutes."}
        </p>
      </div>

      {/* Four-section overview */}
      <div className="mb-10 grid grid-cols-2 gap-3">
        {SECTIONS.map((section, i) => (
          <div
            key={section.key}
            className="card rounded-[var(--radius-sm)] border border-hair bg-card p-4"
          >
            <div className="mb-2 flex items-center gap-2">
              <span className="chip font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="text-[13px] font-semibold text-ink">{section.label}</span>
            </div>
            <p className="text-[13px] leading-[1.4] text-ink-3">{section.description}</p>
          </div>
        ))}
      </div>

      {/* CTA */}
      <div className="flex justify-center">
        <button
          type="button"
          onClick={onStart}
          className="btn-primary rounded-[var(--radius-sm)] bg-accent px-8 py-3 text-[14px] font-medium text-accent-on transition-opacity hover:opacity-90"
        >
          Start Here
        </button>
      </div>

      <p className="mt-6 text-center text-[12px] leading-[1.4] text-ink-4">
        Your information is shared only with your advisor and is never sold or shared with third parties.
      </p>
    </div>
  );
}

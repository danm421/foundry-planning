"use client";

import {
  INTAKE_SECTION_LABELS,
  type IntakeSectionKey,
} from "@/lib/intake/sections";

interface WelcomeScreenProps {
  mode: "blank" | "prefilled";
  onStart: () => void;
  sections: readonly IntakeSectionKey[];
}

interface WelcomeCard { key: string; label: string; description: string }

/**
 * The overview cards. Accounts / Income / Property collapse into one "Assets"
 * card because that is how the client experiences them — three short steps
 * under one idea — and because six cards in a two-column grid reads as a longer
 * form than it is. Review always appears; it is chrome, not a section.
 */
export function welcomeCards(sections: readonly IntakeSectionKey[]): WelcomeCard[] {
  const cards: WelcomeCard[] = [];
  const card = (key: IntakeSectionKey, description: string): WelcomeCard => ({
    key,
    label: INTAKE_SECTION_LABELS[key],
    description,
  });

  if (sections.includes("family")) {
    cards.push(card("family", "Who the plan covers — you, a spouse, and any dependents."));
  }
  if (sections.some((s) => s === "accounts" || s === "income" || s === "property")) {
    // Hand-authored: a bucket spanning three sections has no key to read from.
    cards.push({ key: "assets", label: "Assets", description: "Investment accounts, income sources, and property you own." });
  }
  if (sections.includes("goals")) {
    cards.push(card("goals", "When you want to retire and what retirement should cost."));
  }
  if (sections.includes("estate")) {
    cards.push(
      card("estate", "Who your documents should name, and how your children inherit."),
    );
  }
  if (sections.includes("documents")) {
    cards.push(card("documents", "Statements, tax returns, and anything else worth sharing."));
  }
  if (sections.includes("risk")) {
    cards.push(card("risk", "A few questions about how you'd handle market ups and downs."));
  }
  // Likewise hand-authored: Review is chrome, so it has no section key either.
  cards.push({ key: "review", label: "Review", description: "Confirm everything looks right before submitting to your advisor." });
  return cards;
}

export function WelcomeScreen({ mode, onStart, sections }: WelcomeScreenProps) {
  const cards = welcomeCards(sections);
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

      {/* Section overview */}
      <div className="mb-10 grid grid-cols-2 gap-3">
        {cards.map((card, i) => (
          <div
            key={card.key}
            className="card rounded-[var(--radius-sm)] border border-hair bg-card p-4"
          >
            <div className="mb-2 flex items-center gap-2">
              <span className="chip font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="text-[13px] font-semibold text-ink">{card.label}</span>
            </div>
            <p className="text-[13px] leading-[1.4] text-ink-3">{card.description}</p>
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

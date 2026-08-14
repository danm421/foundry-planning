// Which proposal prints, which sections print, and how the commentary reads.
"use client";
import { useId } from "react";
import {
  SECTION_IDS,
  SECTION_TITLES,
  type InvestmentProposalOptions,
} from "@/lib/presentations/pages/investment-proposal/options-schema";
import { OptionsRow, OptionsGroup } from "@/components/presentations/shared/options-layout";
import { useProposalOptions } from "@/components/presentations/options-context";
import { FieldTooltip } from "@/components/forms/field-tooltip";

const caption = "text-[11px] uppercase tracking-[0.1em] text-ink-3";

export function InvestmentProposalOptionsControl({
  value,
  onChange,
}: {
  value: InvestmentProposalOptions;
  onChange: (next: InvestmentProposalOptions) => void;
}) {
  const proposals = useProposalOptions();
  // A real `<label for>` needs a real id, and this control can render twice on
  // one page (two proposal pages in the same deck).
  const proposalFieldId = useId();

  return (
    <OptionsRow>
      <OptionsGroup>
        <div className={`flex items-center gap-1.5 ${caption}`}>
          <label htmlFor={proposalFieldId}>Proposal</label>
          <FieldTooltip text="The saved proposal this page prints. Its figures are frozen at the moment it was computed and do not update — recompute it in the builder if the client's holdings have moved." />
        </div>
        <select
          id={proposalFieldId}
          className="w-64 rounded border border-hair bg-card-2 px-2 py-1 text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40"
          value={value.proposalId}
          onChange={(e) => onChange({ ...value, proposalId: e.target.value })}
        >
          <option value="">— No proposal picked —</option>
          {proposals.map((p) => (
            <option key={p.id} value={p.id}>
              {`${p.name} · ${p.targetLabel}`}
            </option>
          ))}
        </select>
      </OptionsGroup>

      <OptionsGroup label="Sections">
        {SECTION_IDS.map((id) => (
          <label key={id} className="flex items-center gap-2 hover:text-ink">
            <input
              type="checkbox"
              className="accent-accent"
              checked={value.sections[id]}
              onChange={(e) =>
                onChange({ ...value, sections: { ...value.sections, [id]: e.target.checked } })
              }
            />
            <span>{SECTION_TITLES[id]}</span>
          </label>
        ))}
      </OptionsGroup>

      <OptionsGroup label="Commentary">
        <select
          aria-label="Commentary tone"
          className="w-40 rounded border border-hair bg-card-2 px-2 py-1 text-ink"
          value={value.tone}
          onChange={(e) =>
            onChange({ ...value, tone: e.target.value as InvestmentProposalOptions["tone"] })
          }
        >
          <option value="plain">Plain</option>
          <option value="concise">Concise</option>
          <option value="detailed">Detailed</option>
        </select>
        <select
          aria-label="Commentary length"
          className="w-40 rounded border border-hair bg-card-2 px-2 py-1 text-ink"
          value={value.length}
          onChange={(e) =>
            onChange({ ...value, length: e.target.value as InvestmentProposalOptions["length"] })
          }
        >
          <option value="short">Short</option>
          <option value="medium">Medium</option>
          <option value="long">Long</option>
        </select>
      </OptionsGroup>
    </OptionsRow>
  );
}

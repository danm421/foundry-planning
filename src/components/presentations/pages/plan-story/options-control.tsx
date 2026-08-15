// What prints, which plan it presents, and the panel where a human reads it
// first. One control, because the advisor's mental model is "this report, with
// options" — the review panel below the toggles is the same story the toggles
// describe, on the same scenario.
"use client";
import { useId, useMemo } from "react";
import {
  applyPreset,
  type PlanStoryOptions,
  type PresetId,
} from "@/lib/presentations/pages/plan-story/options-schema";
import { CHAPTERS } from "@/lib/presentations/story/chapters/registry";
import {
  CHAPTER_IDS,
  CHAPTER_LENGTHS,
  CHAPTER_TONES,
  resolveChapterStyles,
  type ChapterId,
  type ChapterStyle,
} from "@/lib/presentations/story/types";
import { OptionsRow, OptionsGroup } from "@/components/presentations/shared/options-layout";
import { useClientId, useScenarioOptions } from "@/components/presentations/options-context";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import { PlanStoryReviewPanel } from "./review-panel";

const PRESET_CHOICES: Array<{ id: PresetId; label: string }> = [
  { id: "full", label: "Full story" },
  { id: "brief", label: "Executive brief" },
];

const caption = "text-[11px] uppercase tracking-[0.1em] text-ink-3";

/**
 * The spec's own caveat about the Executive brief, shown only while that preset
 * is picked.
 *
 * Not a permanent line under the buttons, and not a tooltip: the canvas stays
 * quiet for the advisor who is not using this preset, and the one who IS gets
 * told rather than left to discover it in a client meeting.
 */
const BRIEF_CAVEAT =
  "Best in front of a curated deck — three pages of plain English ahead of forty-five pages of tables reads as a cliff.";

/** The story's spine and the per-area chapters, split exactly as the registry
 *  marks them. Two groups rather than fourteen checkboxes in one column: the
 *  four an advisor switches off because someone else handles that area are a
 *  different decision from the ten that carry the story. */
const STRUCTURAL = CHAPTER_IDS.filter((id) => !CHAPTERS[id].coverage);
const COVERAGE = CHAPTER_IDS.filter((id) => CHAPTERS[id].coverage);

/** The advisor's words for the two settings, matching the review panel's. */
const TONE_LABELS: Record<ChapterStyle["tone"], string> = {
  warm: "Warm",
  plain: "Plain",
  direct: "Direct",
};

const LENGTH_LABELS: Record<ChapterStyle["length"], string> = {
  short: "Short",
  standard: "Standard",
  full: "Full",
};

/**
 * Per field, because a `FieldTooltip` belongs to the control it sits beside —
 * and because the one thing an advisor has to know here is that this writes to
 * all fourteen chapters rather than sitting behind them as a default.
 *
 * ⚠️ The word "voice" is deliberately absent from this whole group. It already
 * names the voice-SAMPLE library in this feature, which the review panel below
 * points at by name ("Settings → Voice"), so a group called Voice would put two
 * unrelated controls under one word on one screen.
 */
const readsTooltip = (what: string) =>
  `Sets the ${what} of every chapter at once. Change a single chapter in Review below — this then reads Mixed.`;

const FIELD_SELECT =
  "w-32 rounded border border-hair bg-card-2 px-2 py-1 text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40";

/**
 * The value all fourteen chapters share, or `""` when they do not.
 *
 * ⚠️ There is no stored report-level default to read: `PlanStoryOptions` holds
 * `chapterStyle` PER CHAPTER and nothing else. So this control is a bulk setter
 * over those fourteen entries, and the only honest thing it can display is what
 * they actually say. Without the mixed answer it would show one chapter's value
 * as though it were the report's, and quietly contradict the panel below it.
 *
 * ⚠️ Takes the RESOLVED map — never `value.chapterStyle`, which a deck saved
 * before the field existed does not carry. See `styles` in the component.
 */
function sharedValue<K extends keyof ChapterStyle>(
  chapterStyle: Record<ChapterId, ChapterStyle>,
  field: K,
): ChapterStyle[K] | "" {
  const first = chapterStyle[CHAPTER_IDS[0]][field];
  return CHAPTER_IDS.every((id) => chapterStyle[id][field] === first) ? first : "";
}

export function PlanStoryOptionsControl({
  value,
  onChange,
}: {
  value: PlanStoryOptions;
  onChange: (next: PlanStoryOptions) => void;
}) {
  const clientId = useClientId();
  const scenarios = useScenarioOptions();
  /** A real `<label for>` needs a real id, and this control can render twice on
   *  one page (two Plan Story entries in the same deck). */
  const scenarioFieldId = useId();
  const toneFieldId = useId();
  const lengthFieldId = useId();

  /**
   * Every chapter's style, gaps filled — and the ONLY thing this control reads.
   *
   * ⚠️⚠️ RESOLVED rather than read straight off `value`. `chapterStyle` shipped
   * after this page did, and stored options are validated on WRITE only: the
   * template read path casts (`templates-repo.ts`), the localStorage draft
   * restores raw (`use-launcher-draft.ts`), and the launcher hands the object
   * over untouched (`selected-page-row.tsx`). So EVERY deck and draft saved
   * before that ships arrives here without the field, and reading into it during
   * render threw and took the whole Options dialog with it.
   *
   * The panel beside this one already types its copy `Partial<…>` for exactly
   * this reason; this is the same admission on the control's side.
   *
   * ⚠️ Do NOT extend the same treatment to `value.sections` below. A missing key
   * there is an uncontrolled-input warning rather than a throw, and `sections`
   * has existed for as long as the page has — there is no stored deck without it.
   */
  const styles = useMemo(() => resolveChapterStyles(value.chapterStyle), [value.chapterStyle]);

  /**
   * Writes ONE field across all fourteen entries, keeping each chapter's other
   * field as it stands.
   *
   * ⚠️ Deliberately does NOT drop the report out of its preset, unlike the
   * chapter checkboxes below. A preset names a document role and a chapter set
   * — `PRESETS` carries exactly those two — and says nothing about how it reads,
   * so a "Full story" deck written in a direct register is still a Full story.
   */
  function setEveryChapter<K extends keyof ChapterStyle>(field: K, next: ChapterStyle[K]) {
    onChange({
      ...value,
      chapterStyle: Object.fromEntries(
        CHAPTER_IDS.map((id) => [id, { ...styles[id], [field]: next }]),
      ) as Record<ChapterId, ChapterStyle>,
    });
  }

  const sharedTone = sharedValue(styles, "tone");
  const sharedLength = sharedValue(styles, "length");

  // Live scenarios only — the same set `ScenarioPickerDropdown` calls live, and
  // load-bearing rather than tidy here. Everything this drops writes a
  // `scenarioId` that `planStoryProposedRef` reads as "there IS a proposed
  // plan" while the story has nothing to propose, so the report prints the
  // heading "What we're recommending, and why" over "We aren't suggesting
  // changes to the plan this time":
  //   · the base-case row — a plan compared against itself;
  //   · `writer-test-*` orphans left by integration tests that crashed;
  //   · a `snap:` ref — refused outright by generation (400) while GET answers
  //     200 with an all-never-generated list, so the panel would offer a
  //     Generate button that can only fail.
  const liveScenarios = scenarios.filter(
    (s) => !s.isBaseCase && !s.name.startsWith("writer-test-") && !s.id.startsWith("snap:"),
  );

  /** Any manual toggle drops the report out of a named preset — otherwise the
   *  launcher row would keep claiming "Full story" for a deck that no longer is
   *  one. */
  function chapterBox(id: (typeof CHAPTER_IDS)[number]) {
    return (
      <label key={id} className="flex items-center gap-2 hover:text-ink">
        <input
          type="checkbox"
          className="accent-accent"
          checked={value.sections[id]}
          onChange={(e) =>
            onChange({
              ...value,
              preset: "custom",
              sections: { ...value.sections, [id]: e.target.checked },
            })
          }
        />
        <span>{CHAPTERS[id].title}</span>
      </label>
    );
  }

  return (
    <div className="space-y-4">
      <OptionsRow>
        <OptionsGroup label="Preset">
          {PRESET_CHOICES.map((p) => (
            <label key={p.id} className="flex items-center gap-2 hover:text-ink">
              <input
                type="radio"
                name="plan-story-preset"
                className="accent-accent"
                checked={value.preset === p.id}
                onChange={() => onChange(applyPreset(value, p.id))}
              />
              <span>{p.label}</span>
            </label>
          ))}
          {value.preset === "brief" && (
            <p className="max-w-56 text-[11px] leading-snug text-ink-3">{BRIEF_CAVEAT}</p>
          )}
        </OptionsGroup>

        {/* Beside the preset, because both answer "how does this report read"
            before the chapter checkboxes answer "what is in it". */}
        <OptionsGroup label="How it reads">
          <div className={`flex items-center gap-1.5 ${caption}`}>
            <label htmlFor={toneFieldId}>Tone</label>
            <FieldTooltip text={readsTooltip("tone")} />
          </div>
          <select
            id={toneFieldId}
            className={FIELD_SELECT}
            value={sharedTone}
            onChange={(e) => setEveryChapter("tone", e.target.value as ChapterStyle["tone"])}
          >
            {/* Shown only when the fourteen disagree, and DISABLED: "Mixed" is
                something the chapters are, not something an advisor can pick.
                Absent when they agree, so the select never offers a state it is
                not in. */}
            {sharedTone === "" && (
              <option value="" disabled>
                Mixed
              </option>
            )}
            {CHAPTER_TONES.map((tone) => (
              <option key={tone} value={tone}>
                {TONE_LABELS[tone]}
              </option>
            ))}
          </select>

          <div className={`flex items-center gap-1.5 ${caption}`}>
            <label htmlFor={lengthFieldId}>Length</label>
            <FieldTooltip text={readsTooltip("length")} />
          </div>
          <select
            id={lengthFieldId}
            className={FIELD_SELECT}
            value={sharedLength}
            onChange={(e) => setEveryChapter("length", e.target.value as ChapterStyle["length"])}
          >
            {sharedLength === "" && (
              <option value="" disabled>
                Mixed
              </option>
            )}
            {CHAPTER_LENGTHS.map((length) => (
              <option key={length} value={length}>
                {LENGTH_LABELS[length]}
              </option>
            ))}
          </select>
        </OptionsGroup>

        <OptionsGroup label="The story">
          {/* Ten chapters read better as two short columns than one tall one. */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-1">{STRUCTURAL.map(chapterBox)}</div>
        </OptionsGroup>

        <OptionsGroup label="Areas you cover">{COVERAGE.map(chapterBox)}</OptionsGroup>

        <OptionsGroup>
          <div className={`flex items-center gap-1.5 ${caption}`}>
            {/* A real label rather than an `aria-label`: it names the control to
                a screen reader AND gives the caption a click target. */}
            <label htmlFor={scenarioFieldId}>Proposed plan</label>
            <FieldTooltip text="The scenario this report recommends. Leave it at no proposed plan for a base-only story — the report then skips 'What we're recommending, and why'. This is the story's subject, not the deck's scenario." />
          </div>
          <select
            id={scenarioFieldId}
            className="w-56 rounded border border-hair bg-card-2 px-2 py-1 text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40"
            value={value.scenarioId}
            onChange={(e) => onChange({ ...value, scenarioId: e.target.value })}
          >
            <option value="">— No proposed plan —</option>
            {liveScenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </OptionsGroup>
      </OptionsRow>

      {/* `useClientId()` answers "" with no provider, and a component-library
          render of this control must not fire a GET at /api/clients//plan-story. */}
      {clientId !== "" && (
        <div className="space-y-2 border-t border-hair pt-4">
          <div className={caption}>Review</div>
          {/* `documentRole` travels with the scenario: the panel is the only
              caller of the generate route, so this is where the preset stops
              being a page-layout choice and becomes what the model is told. */}
          <PlanStoryReviewPanel
            clientId={clientId}
            scenarioId={value.scenarioId}
            documentRole={value.documentRole}
            chapterStyle={styles}
            // One chapter's entry, replaced. The panel holds no style of its
            // own — this is the write, and the options are what the deck saves,
            // what a reload reads back and what the export prints from.
            //
            // Spreads the RESOLVED map, so a pre-style deck is written back
            // complete rather than having one key set beside thirteen absences.
            onChapterStyleChange={(chapterId, style) =>
              onChange({ ...value, chapterStyle: { ...styles, [chapterId]: style } })
            }
          />
        </div>
      )}
    </div>
  );
}

// Shared input styling for dialog forms.
//
// Fill is `bg-paper` — the field reads as an inset one step behind whatever
// card or panel encloses it, in every theme. (Under Industrial Dark the raised
// panel token `card-2` is DARKER than `card`, so a field left on `card-2`
// would disappear into the task side panel.)
//
// Two variants per element:
//   - `*BaseClassName` — no width. Use when the caller controls width itself
//     (fixed `w-N`, `flex-1 min-w-0`, etc.). Avoids cascade fights with
//     Tailwind utilities that compete with `w-full`.
//   - `inputClassName` / `selectClassName` / `textareaClassName` — base + `w-full`.
//     The default for inputs that should fill their container.
//
// Sibling inputs in a flex row should follow:
//   <div className="flex gap-2">
//     <input className={`${inputBaseClassName} flex-1 min-w-0`} />
//     <select className={`${selectBaseClassName} w-20 shrink-0`} />
//   </div>

const inputCore =
  "h-9 rounded-[var(--radius-sm)] bg-paper border border-hair-2 px-3 text-[14px] text-ink placeholder:text-ink-4 outline-none " +
  "hover:border-hair-3 focus:border-accent focus:ring-2 focus:ring-accent/25 disabled:opacity-50";

export const inputBaseClassName = inputCore;
export const inputClassName = "w-full " + inputCore;

// The same recipe one step shorter, for an input that sits inside a table cell.
// It keeps the hover/focus treatment so a grid cell reads as editable the way a
// form field does — that affordance is the whole reason it exists.
const inputCompactCore =
  "h-8 rounded-[var(--radius-sm)] bg-paper border border-hair-2 px-2 text-[14px] text-ink placeholder:text-ink-4 outline-none " +
  "hover:border-hair-3 focus:border-accent focus:ring-2 focus:ring-accent/25 disabled:opacity-50";

export const inputCompactBaseClassName = inputCompactCore;
export const inputCompactClassName = "w-full " + inputCompactCore;

// The chevron is the `select-chevron` utility in globals.css. It can't be an
// arbitrary background-image class here: the inline SVG holds spaces, and a
// class attribute splits on whitespace, so that class never matched and every
// select drew no arrow at all. (Don't spell such a class out in a comment
// either — Tailwind scans comments and would emit it.)
const selectExtras = " appearance-none pr-8 select-chevron";

/**
 * The chevron + appearance reset alone, with NO border, fill or size.
 *
 * Exported so a caller that needs its own border can COMPOSE one rather than
 * appending an override to `selectBaseClassName`. Two `border-*` utilities in
 * one class string are resolved by their order in the GENERATED stylesheet,
 * not by their order in the attribute, so an override appended there wins or
 * loses depending on what else the app happens to use.
 */
export const selectChevronClassName = selectExtras.trim();

export const selectBaseClassName = inputCore + selectExtras;
export const selectClassName = "w-full " + selectBaseClassName;

const textareaCore =
  "rounded-[var(--radius-sm)] bg-paper border border-hair-2 px-3 py-2 text-[14px] text-ink placeholder:text-ink-4 outline-none " +
  "hover:border-hair-3 focus:border-accent focus:ring-2 focus:ring-accent/25 disabled:opacity-50";

export const textareaBaseClassName = textareaCore;
export const textareaClassName = "w-full " + textareaCore;

// A label carries the gap to its control (`mb-1.5`); the control carries none,
// so fields in one row line up whatever sits between label and control.
export const fieldLabelBaseClassName = "text-[13px] font-medium text-ink-2";

export const fieldLabelClassName = "block mb-1.5 " + fieldLabelBaseClassName;

// The form checkbox. One look for every on/off box in a dialog form, so a row
// of them never mixes a styled box with the browser's default.
export const checkboxClassName = "h-4 w-4 rounded border-hair-3 bg-card-2 text-accent focus:ring-accent";

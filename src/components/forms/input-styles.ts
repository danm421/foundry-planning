// Shared input styling for dialog forms.
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
  "h-9 rounded-[var(--radius-sm)] bg-card-2 border border-hair px-3 text-[14px] text-ink placeholder:text-ink-4 outline-none " +
  "hover:border-hair-2 focus:border-accent focus:ring-2 focus:ring-accent/25 disabled:opacity-50";

export const inputBaseClassName = inputCore;
export const inputClassName = "w-full " + inputCore;

const selectExtras =
  " appearance-none pr-8 bg-no-repeat bg-[right_0.5rem_center] " +
  // amber chevron, base64-inlined to avoid an asset import
  "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 20 20%22 fill=%22%238b909c%22><path fill-rule=%22evenodd%22 d=%22M5.23 7.21a.75.75 0 011.06.02L10 11.04l3.71-3.81a.75.75 0 111.08 1.04l-4.25 4.36a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z%22 clip-rule=%22evenodd%22/></svg>')]";

export const selectBaseClassName = inputCore + selectExtras;
export const selectClassName = "w-full " + selectBaseClassName;

const textareaCore =
  "rounded-[var(--radius-sm)] bg-card-2 border border-hair px-3 py-2 text-[14px] text-ink placeholder:text-ink-4 outline-none " +
  "hover:border-hair-2 focus:border-accent focus:ring-2 focus:ring-accent/25 disabled:opacity-50";

export const textareaBaseClassName = textareaCore;
export const textareaClassName = "w-full " + textareaCore;

export const fieldLabelClassName =
  "block mb-1.5 text-[12px] font-medium text-ink-3";

// Where an advisor decides how the writing assistant sounds, and — because a
// sample is one household's prose kept for use on another's report — where they
// can read every word of it and take it back.
//
// It follows the Plan Story review panel's three rules, and for the same
// reasons:
//
// 1. An empty list is "not loaded yet", NEVER "all clear". No count of what
//    reaches the prompt is rendered until a GET has actually answered, so a 403
//    or a 500 cannot draw a panel that reports zero samples over a firm that has
//    six.
// 2. A failure is reported against the ROW it was about. With a list of samples
//    an advisor works down, one message for the whole panel is cleared by the
//    next row's success — so "this one didn't switch off" disappears while that
//    sample keeps going into every report.
// 3. A failed save leaves the typed words in the box. Nothing here clears a
//    textarea except a write that landed.
//
// Two things it adds on top:
//
//   THE CAP IS VISIBLE. `resolveVoice` sends at most `MAX_SAMPLES`, so an
//   advisor who switches on six has two that go nowhere. A list of six live
//   toggles and no other signal reports a state the model never sees, which is
//   rule 1's failure wearing a different hat. The rows that reach a prompt are
//   marked apart from the rows that are merely on.
//
//   DELETE IS OFFERED, not only disable. Switching a sample off stops it being
//   sent; the words stay in the table. The scrubber is good and is not perfect,
//   so an advisor who spots a client's name in a stored sample needs it GONE.
//   Destructive and unrecoverable, so it asks first.
"use client";
import { useCallback, useEffect, useState } from "react";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import { MAX_SAMPLES, isSendable } from "@/lib/presentations/story/voice/resolve";
import { sampleRefusal, styleNoteRefusal } from "@/lib/presentations/story/voice/refusal";
import { VOICE_TEXT_MAX, VOICE_TEXT_MIN } from "@/lib/schemas/story-voice";

interface VoiceProfile {
  /** Whose row this is. Equal to the caller's own id, or the firm default's. */
  advisorUserId: string;
  styleNote: string;
}

interface VoiceSample {
  id: string;
  /** The STORED text — already scrubbed, and exactly what the model is sent. */
  text: string;
  sourceChapterId: string | null;
  enabled: boolean;
  firmDefault: boolean;
}

/**
 * What each surface says when the request itself failed, as opposed to when the
 * server refused the content. No status codes: the number is in the console for
 * whoever debugs it, and none of them changes what the advisor does next. Each
 * one names what did NOT happen, so a failure cannot read like a save that
 * landed.
 */
const COULD_NOT_LOAD_NOTE = "Couldn't load your style note. Check your connection and try again.";
const COULD_NOT_LOAD_SAMPLES = "Couldn't load your samples. Check your connection and try again.";
const COULD_NOT_SAVE_NOTE = "Couldn't save your style note. Your words are still in the box — try again.";
const COULD_NOT_SAVE_SAMPLE = "Couldn't save that sample. Your words are still in the box — try again.";
const COULD_NOT_SWITCH = "Couldn't change that. It's left as it was — try again.";
const COULD_NOT_DELETE = "Couldn't delete that sample. It's still here — try again.";

/**
 * Which of the two notes the advisor is about to overwrite. `GET /api/story-voice`
 * answers with the firm's default when they have no row of their own, so the box
 * can be full of words that belong to the whole firm — and saving from it writes
 * a row of their own and leaves the firm's alone unless they say otherwise.
 */
const READING_THE_FIRMS_NOTE =
  "You're reading your firm's default note — you haven't written one of your own.";
const SAVING_WRITES_YOUR_OWN_ADMIN =
  " Saving writes your own note; tick the box below to change the firm's.";
const SAVING_WRITES_YOUR_OWN_MEMBER =
  " Saving writes your own note and leaves the firm's alone.";
const NO_NOTE_ANYWHERE = "You haven't written a style note, and your firm hasn't set a default.";

/**
 * Deleting drops the row. There is no undo anywhere in this feature — the words
 * are gone from the table, which is exactly what an advisor who spotted a
 * client's name in a stored sample is asking for. Say so before they confirm.
 *
 * A firm-shared row gets its own sentence, because the act is a different act:
 * the row goes out of every colleague's reports, not only this advisor's. First
 * person over a firm-wide, unrecoverable action is how someone deletes for
 * eleven people believing they deleted for one.
 */
const DELETE_IS_FOREVER = "Delete these words for good? This can't be undone.";
const DELETE_IS_FOREVER_FOR_EVERYONE =
  "Delete this for everyone at your firm, for good? This can't be undone.";

/** Same argument, one step milder: switching a shared row off stops it in every
 *  colleague's reports too. */
const SEND_THIS = "Send this to the writing assistant";
const SEND_THIS_FIRM = "Send this on everyone's reports";

/** Why a member's controls on a shared row are dead. Shown rather than hiding
 *  them: a member who cannot find the control learns nothing, and an admin
 *  reading over their shoulder needs to see the same row. */
const FIRM_ROW_IS_ADMIN_ONLY =
  "Shared with your firm — everyone here sends this one. Only a firm admin can switch it off or delete it.";
const FIRM_ROW_IS_SHARED =
  "Shared with your firm — everyone here sends this one. Changing it changes every colleague's reports.";

/** The cap read off `resolveVoice`, not spelled again. See `sentIds` below. */
const PAST_THE_CAP =
  `Switched on, but only the ${MAX_SAMPLES} newest switched-on samples are sent. This one isn't.`;

/** Switched on with nothing in it. `resolveVoice` drops a blank sample before it
 *  counts toward the cap (`resolve.ts#isSendable`), so this row is neither sent
 *  nor waiting behind the four that are — a different fact from `PAST_THE_CAP`,
 *  and it gets its own sentence rather than that one's. */
const NOTHING_TO_SEND = "Switched on, but there are no words in it to send.";

function sourceLabel(chapterId: string | null, chapterTitles: Record<string, string>): string {
  if (chapterId == null) return "Written here";
  const title = chapterTitles[chapterId];
  return title ? `From “${title}”` : "From a chapter this version of the report doesn't have";
}

/** Pinned to en-US rather than the ambient locale, matching `refusal.ts`. */
function commas(n: number): string {
  return n.toLocaleString("en-US");
}

/** One key gone, as a new object — the shape React state updates need. */
function without(map: Record<string, string>, key: string): Record<string, string> {
  const next = { ...map };
  delete next[key];
  return next;
}

/**
 * A live character count beside a box. Advisory only: the routes are the
 * authority on what fits, and a refusal from them names the same bound.
 *
 * ⚠️ `min` is per FIELD and must be omitted where the schema has no floor.
 * `storyVoiceSamplePostSchema.text` is `.min(20)`; `storyVoiceProfilePutSchema.styleNote`
 * is `.max()` alone (`schemas/story-voice.ts`). A shared floor here told an
 * advisor that "Short sentences." — sixteen characters, and a perfectly good
 * style note — was too short to save, which is the panel stating a limit the
 * server does not enforce.
 */
function CharacterCount({ length, min }: { length: number; min?: number }) {
  // An empty box is not "too short" — it is a box nobody has typed in yet.
  const tooShort = min != null && length > 0 && length < min;
  return (
    <p className={`text-xs ${tooShort || length > VOICE_TEXT_MAX ? "text-warn" : "text-ink-3"}`}>
      <span className="tabular">{commas(length)}</span> /{" "}
      <span className="tabular">{commas(VOICE_TEXT_MAX)}</span> characters
      {tooShort && (
        <> — at least <span className="tabular">{min}</span> to save</>
      )}
    </p>
  );
}

export function VoiceProfilePanel({
  isAdmin,
  userId,
  chapterTitles,
}: {
  /**
   * Does this advisor get the "save it for the whole firm" checkboxes? An
   * AFFORDANCE only — `PUT /api/story-voice` and `POST /api/story-voice/samples`
   * both call `requireOrgAdminOrOwner` when the flag arrives set, so a member
   * who forges the request is refused there.
   */
  isAdmin: boolean;
  /** The caller's own Clerk id, so a note that came back under a different one
   *  can be named as the firm's. See `page.tsx`. */
  userId: string;
  /**
   * `chapterId` → heading, built in the SERVER page from `chapters/registry.ts`.
   *
   * A prop rather than an import, and the reason is bundle weight: `CHAPTERS`
   * holds every chapter's `narrate` FUNCTION as a value, so nothing can tree-shake
   * the narrator modules away and importing it here lands its whole 43-file
   * closure in this route's browser bundle to render fourteen strings. The
   * registry stays the single spelling of the titles; it just does the spelling
   * on the server.
   */
  chapterTitles: Record<string, string>;
}) {
  const [profile, setProfile] = useState<VoiceProfile | null>(null);
  const [noteLoaded, setNoteLoaded] = useState(false);
  const [note, setNote] = useState("");
  const [noteProblem, setNoteProblem] = useState<string | null>(null);
  const [noteStatus, setNoteStatus] = useState<string | null>(null);
  const [savingNote, setSavingNote] = useState(false);
  const [noteForFirm, setNoteForFirm] = useState(false);

  const [samples, setSamples] = useState<VoiceSample[]>([]);
  const [samplesLoaded, setSamplesLoaded] = useState(false);
  const [samplesProblem, setSamplesProblem] = useState<string | null>(null);
  /** Rule 2: a failed switch or a failed delete, against the row it was about. */
  const [rowProblems, setRowProblems] = useState<Record<string, string>>({});
  /** The row with a write in flight, so a second click cannot double-write it. */
  const [busyRow, setBusyRow] = useState<string | null>(null);
  /** The row whose Delete has been pressed once. Deleting is unrecoverable, so
   *  the second press is a separate deliberate act. */
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  const [draft, setDraft] = useState("");
  const [draftProblem, setDraftProblem] = useState<string | null>(null);
  const [draftStatus, setDraftStatus] = useState<string | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftForFirm, setDraftForFirm] = useState(false);

  const loadNote = useCallback(async () => {
    try {
      const res = await fetch("/api/story-voice");
      if (!res.ok) throw new Error(`GET story-voice ${res.status}`);
      const body = (await res.json()) as { profile: VoiceProfile | null };
      setProfile(body.profile);
      setNote(body.profile?.styleNote ?? "");
      // Only on the success path — rule 1. A refused GET leaves this false and
      // the panel says nothing about whose note is in force.
      setNoteLoaded(true);
      setNoteProblem(null);
    } catch (err) {
      console.error("[voice] could not load the style note", err);
      setNoteProblem(COULD_NOT_LOAD_NOTE);
    }
  }, []);

  const loadSamples = useCallback(async () => {
    try {
      const res = await fetch("/api/story-voice/samples");
      if (!res.ok) throw new Error(`GET story-voice/samples ${res.status}`);
      const body = (await res.json()) as { samples: VoiceSample[] };
      setSamples(body.samples);
      setSamplesLoaded(true);
      setSamplesProblem(null);
    } catch (err) {
      console.error("[voice] could not load the samples", err);
      setSamplesProblem(COULD_NOT_LOAD_SAMPLES);
    }
    // Deliberately NOT clearing `rowProblems`: this reload runs after every
    // row's success, and clearing here is how one row's failure vanishes behind
    // a different row's. Each row's message is cleared by that row's own next
    // success.
  }, []);

  useEffect(() => {
    void loadNote();
    void loadSamples();
  }, [loadNote, loadSamples]);

  async function saveNote() {
    setSavingNote(true);
    setNoteStatus(null);
    try {
      const res = await fetch("/api/story-voice", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ styleNote: note, firmDefault: noteForFirm }),
      });
      if (!res.ok) {
        // A note over the ceiling is a PERMANENT 400, and "try again" is the one
        // instruction that cannot work on it. Same argument as the sample box —
        // `styleNoteRefusal` reads the server's own issue list and names the
        // bound. It carries no floor, because this field has none.
        const body = await res.json().catch(() => null);
        setNoteProblem(styleNoteRefusal(body, note, COULD_NOT_SAVE_NOTE));
        return;
      }
      setNoteProblem(null);
      if (noteForFirm) {
        // The advisor's OWN row is untouched by a firm write, and their own row
        // is what `GET /api/story-voice` hands back when they have one — so the
        // profile in hand is left exactly as loaded and the box keeps the words
        // that were just sent.
        setNoteStatus(
          "Saved as your firm's default. It applies to everyone here who hasn't written their own.",
        );
        return;
      }
      setProfile({ advisorUserId: userId, styleNote: note });
      setNoteStatus("Saved. It goes into every chapter of your Plan Stories.");
    } catch (err) {
      console.error("[voice] style-note save failed", err);
      setNoteProblem(COULD_NOT_SAVE_NOTE);
    } finally {
      setSavingNote(false);
    }
  }

  async function saveDraft() {
    setSavingDraft(true);
    setDraftStatus(null);
    try {
      const res = await fetch("/api/story-voice/samples", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: draft, firmDefault: draftForFirm }),
      });
      if (!res.ok) {
        // The route refuses a sample outside the schema's bounds, and a bare
        // "couldn't save that" over a 2,400-character passage is a failure with
        // no visible cause. `sampleRefusal` names which bound and by how much.
        const body = await res.json().catch(() => null);
        setDraftProblem(sampleRefusal(body, draft, COULD_NOT_SAVE_SAMPLE));
        return;
      }
      setDraftProblem(null);
      // Cleared only here, on the success path — rule 3.
      setDraft("");
      setDraftStatus("Saved. It's off until you switch it on above.");
      await loadSamples();
    } catch (err) {
      console.error("[voice] sample save failed", err);
      setDraftProblem(COULD_NOT_SAVE_SAMPLE);
    } finally {
      setSavingDraft(false);
    }
  }

  async function switchSample(id: string, enabled: boolean) {
    setBusyRow(id);
    try {
      const res = await fetch(`/api/story-voice/samples/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) {
        // No reload on this path: `samples` is what the checkbox is drawn from,
        // so leaving it alone is what puts the box back where it was.
        setRowProblems((p) => ({ ...p, [id]: COULD_NOT_SWITCH }));
        return;
      }
      setRowProblems((p) => without(p, id));
      await loadSamples();
    } catch (err) {
      console.error("[voice] sample switch failed", id, err);
      setRowProblems((p) => ({ ...p, [id]: COULD_NOT_SWITCH }));
    } finally {
      setBusyRow(null);
    }
  }

  async function deleteSample(id: string) {
    setBusyRow(id);
    try {
      const res = await fetch(`/api/story-voice/samples/${id}`, { method: "DELETE" });
      if (!res.ok) {
        // The confirmation stays open, because the act the advisor asked for has
        // not happened yet and the retry is one click from here.
        setRowProblems((p) => ({ ...p, [id]: COULD_NOT_DELETE }));
        return;
      }
      setRowProblems((p) => without(p, id));
      setConfirmingDelete(null);
      await loadSamples();
    } catch (err) {
      console.error("[voice] sample delete failed", id, err);
      setRowProblems((p) => ({ ...p, [id]: COULD_NOT_DELETE }));
    } finally {
      setBusyRow(null);
    }
  }

  /**
   * The rows that reach a prompt — the SAME test and the SAME cap `resolveVoice`
   * applies, imported rather than re-spelled, over the same newest-first order
   * `listVoiceSamples` returns. A second copy of either here is how this panel
   * would come to report a set of samples the model is not sent.
   */
  const sentIds = new Set(samples.filter(isSendable).slice(0, MAX_SAMPLES).map((s) => s.id));
  const readingFirmNote = noteLoaded && profile != null && profile.advisorUserId !== userId;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-base font-medium text-ink">Your writing voice</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-3">
          Two things shape how a Plan Story sounds: a note describing how you write, and a few
          passages of your own prose the assistant can copy the rhythm of.
        </p>
      </header>

      <section
        aria-labelledby="voice-note-heading"
        className="flex flex-col gap-3 rounded border border-hair p-[var(--pad-card)]"
      >
        <div className="flex items-center gap-1.5">
          <h2 id="voice-note-heading" className="text-sm font-semibold text-ink">
            How you write
          </h2>
          <FieldTooltip text="Added to the assistant's instructions on every chapter of every Plan Story you generate. Describe register and habits — short sentences, no jargon, address them by name once — rather than what a chapter should say." />
        </div>

        {noteProblem != null && (
          <p role="alert" className="text-sm text-crit">
            {noteProblem}
          </p>
        )}

        {readingFirmNote && (
          <p className="text-xs text-warn">
            {READING_THE_FIRMS_NOTE}
            {isAdmin ? SAVING_WRITES_YOUR_OWN_ADMIN : SAVING_WRITES_YOUR_OWN_MEMBER}
          </p>
        )}
        {noteLoaded && profile == null && (
          <p className="text-xs text-ink-3">{NO_NOTE_ANYWHERE}</p>
        )}

        <label className="flex flex-col gap-1 text-sm text-ink-2">
          Style note
          <textarea
            className="min-h-28 w-full rounded border border-hair bg-card-2 p-2 text-sm leading-relaxed text-ink focus:border-accent focus:outline-none"
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              // "Saved." named the words as they stood when it was pressed. Left
              // standing, it sits in `text-good` over words that have not been
              // saved at all. The review panel clears its harvest confirmation
              // on the same event and for the same reason.
              setNoteStatus(null);
            }}
            // Until the GET answers, this box is empty because nothing has been
            // read — not because nothing is there. Saving from it is how an
            // advisor clears a firm note they never saw.
            disabled={!noteLoaded}
          />
        </label>
        {/* No `min`: `styleNote` has a ceiling and no floor. */}
        <CharacterCount length={note.length} />

        {isAdmin && (
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input
              type="checkbox"
              checked={noteForFirm}
              onChange={(e) => setNoteForFirm(e.target.checked)}
            />
            Save as the firm default
          </label>
        )}

        <div className="flex items-center gap-3">
          <button
            type="button"
            className="rounded bg-ink px-3 py-1.5 text-sm text-paper disabled:opacity-50"
            disabled={savingNote || !noteLoaded}
            onClick={() => void saveNote()}
          >
            {savingNote ? "Saving…" : "Save style note"}
          </button>
          {noteStatus != null && (
            <span role="status" className="text-sm text-good">
              {noteStatus}
            </span>
          )}
        </div>
      </section>

      <section
        aria-labelledby="voice-samples-heading"
        className="flex flex-col gap-3 rounded border border-hair p-[var(--pad-card)]"
      >
        <div className="flex items-center gap-1.5">
          <h2 id="voice-samples-heading" className="text-sm font-semibold text-ink">
            Your samples
          </h2>
          <FieldTooltip text="Switching a sample off stops it being sent, and the words stay here. Deleting removes them from Foundry for good — use that if a client's name or a figure survived the scrub." />
        </div>
        {/* Word-level, not byte-level. `prompts.ts#quoteAdvisorText` marks every line of a
            sample so that none of it can be read as an instruction, so the assistant
            sees these words inside a quote. The words themselves are what this
            sentence promises, and nothing is added to them or taken from them. */}
        <p className="max-w-prose text-sm text-ink-3">
          These are the exact words the assistant receives. Names and figures from the household
          it came from were taken out when it was saved.
        </p>

        {samplesProblem != null && (
          <p role="alert" className="text-sm text-crit">
            {samplesProblem}
          </p>
        )}

        {/* Rule 1: nothing about what reaches a prompt is said until the GET has
            answered. Rendered as a live region whether or not it has anything to
            say yet — a screen reader announces a change INSIDE a region it
            already knows about, and this count moves every time a row is
            switched. */}
        <p className="text-sm text-ink-3" aria-live="polite">
          {samplesLoaded && samples.length > 0 && (
            <>
              <span className="tabular">{commas(sentIds.size)}</span> of your{" "}
              <span className="tabular">{commas(samples.length)}</span>{" "}
              {samples.length === 1 ? "sample goes" : "samples go"} into every chapter. The
              assistant takes at most <span className="tabular">{MAX_SAMPLES}</span>, newest first.
            </>
          )}
          {samplesLoaded && samples.length === 0 && (
            <>
              No samples yet. Write one below, or edit a chapter of a Plan Story until it sounds
              like you and use “Save as a voice sample” there.
            </>
          )}
        </p>

        {samples.length > 0 && (
          <ul className="flex flex-col gap-3">
            {samples.map((sample) => {
              const sent = sentIds.has(sample.id);
              // Both derived from the resolver's OWN predicate, so each message
              // states the reason that actually applies: a sendable row that
              // missed the cap is waiting behind four others; a row switched on
              // with no words in it is not waiting for anything.
              const pastTheCap = isSendable(sample) && !sent;
              const nothingToSend = sample.enabled && !isSendable(sample);
              // The route's rule, mirrored: a member may act on their own rows,
              // and on the firm's shared row only as an admin
              // (`samples/[id]/route.ts#mayMutate`). An affordance only — the
              // route refuses either way, with a 404.
              const locked = sample.firmDefault && !isAdmin;
              const labelId = `voice-sample-source-${sample.id}`;
              return (
                <li
                  key={sample.id}
                  // Named by WHAT IT IS — the source label below — rather than by
                  // its position in the list, so the row's accessible name
                  // describes the passage instead of reading "Voice sample 1".
                  // Every message for this row is rendered INSIDE this element,
                  // which is what keeps it attached to the row it is about.
                  aria-labelledby={labelId}
                  className="flex flex-col gap-2 rounded border border-hair p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span id={labelId} className="text-[11px] uppercase tracking-[0.1em] text-ink-3">
                      {sourceLabel(sample.sourceChapterId, chapterTitles)}
                    </span>
                    <span
                      className={`text-[11px] uppercase tracking-[0.1em] ${
                        sent ? "text-good" : pastTheCap || nothingToSend ? "text-warn" : "text-ink-3"
                      }`}
                    >
                      {sent
                        ? "In every chapter"
                        : pastTheCap
                          ? "Over the limit"
                          : nothingToSend
                            ? "Empty"
                            : "Off"}
                    </span>
                  </div>

                  {sample.firmDefault && (
                    <p className="text-xs text-warn">
                      {locked ? FIRM_ROW_IS_ADMIN_ONLY : FIRM_ROW_IS_SHARED}
                    </p>
                  )}

                  {rowProblems[sample.id] != null && (
                    <p role="alert" className="text-sm text-crit">
                      {rowProblems[sample.id]}
                    </p>
                  )}

                  {pastTheCap && <p className="text-xs text-warn">{PAST_THE_CAP}</p>}
                  {nothingToSend && <p className="text-xs text-warn">{NOTHING_TO_SEND}</p>}

                  <p className="whitespace-pre-wrap rounded border border-hair bg-card-2 p-2 text-sm leading-relaxed text-ink-2">
                    {sample.text}
                  </p>

                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 text-xs text-ink-2">
                      <input
                        type="checkbox"
                        checked={sample.enabled}
                        disabled={busyRow === sample.id || locked}
                        onChange={(e) => void switchSample(sample.id, e.target.checked)}
                      />
                      {sample.firmDefault ? SEND_THIS_FIRM : SEND_THIS}
                    </label>

                    {confirmingDelete === sample.id ? (
                      <span className="ml-auto flex flex-wrap items-center gap-3">
                        <span className="text-xs text-warn">
                          {sample.firmDefault ? DELETE_IS_FOREVER_FOR_EVERYONE : DELETE_IS_FOREVER}
                        </span>
                        <button
                          type="button"
                          className="text-xs text-crit underline disabled:no-underline disabled:opacity-50"
                          disabled={busyRow === sample.id}
                          onClick={() => void deleteSample(sample.id)}
                        >
                          Delete permanently
                        </button>
                        <button
                          type="button"
                          className="text-xs text-ink-3 underline hover:text-ink"
                          onClick={() => setConfirmingDelete(null)}
                        >
                          Keep it
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="ml-auto text-xs text-ink-3 underline hover:text-crit disabled:no-underline disabled:opacity-50"
                        disabled={busyRow === sample.id || locked}
                        onClick={() => setConfirmingDelete(sample.id)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex flex-col gap-2 rounded border border-hair p-3">
          <label className="flex flex-col gap-1 text-sm text-ink-2">
            Write a sample
            <textarea
              className="min-h-24 w-full rounded border border-hair bg-card-2 p-2 text-sm leading-relaxed text-ink focus:border-accent focus:outline-none"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                // Same reason as the style note's: "Saved." was about the words
                // that have just been replaced.
                setDraftStatus(null);
              }}
              placeholder="A paragraph or two in your own words — a passage from a letter or a review you were happy with."
            />
          </label>
          {/* `storyVoiceSamplePostSchema.text` carries a floor, so this counter
              names it. The style note's does not. */}
          <CharacterCount length={draft.length} min={VOICE_TEXT_MIN} />

          {isAdmin && (
            <label className="flex items-center gap-2 text-sm text-ink-2">
              <input
                type="checkbox"
                checked={draftForFirm}
                onChange={(e) => setDraftForFirm(e.target.checked)}
              />
              Save for the whole firm
            </label>
          )}

          {draftProblem != null && (
            <p role="alert" className="text-sm text-crit">
              {draftProblem}
            </p>
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              className="rounded bg-ink px-3 py-1.5 text-sm text-paper disabled:opacity-50"
              disabled={savingDraft}
              onClick={() => void saveDraft()}
            >
              {savingDraft ? "Saving…" : "Save sample"}
            </button>
            {draftStatus != null && (
              <span role="status" className="text-sm text-good">
                {draftStatus}
              </span>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

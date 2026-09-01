"use client";

import { useRef, useState, type SVGProps } from "react";
import { AlertCircleIcon, ArrowRightIcon, CheckIcon } from "@/components/icons";
import { resolveAccentColor } from "@/components/pdf/theme";
import type { CheckoutPlan } from "@/lib/billing/checkout";
import { saveSignupProfile, startSignupCheckout, uploadSignupLogo } from "./actions";
import { CoverPreview } from "./cover-preview";
import { deriveColorFromFile } from "./derive-logo-color";

/**
 * The setup step. The premise is that the more of themselves an advisor puts
 * in, the likelier they are to finish at the card — so every field here has to
 * visibly buy them something, which is what the live cover preview is for.
 *
 * Branding is optional and must never gate the card: "Continue to payment" is
 * live the moment the firm name is non-empty, and an upload still in flight
 * delays the button rather than failing it.
 */

export type SetupInitial = {
  firmName: string;
  advisorName: string;
  primaryColor: string | null;
  logoUrl: string | null;
};

/* Firm brand colours the buyer can choose from. These are the accent on the
   ADVISOR's own client-facing document, not Foundry app chrome, so there is no
   brand token for them by definition — a firm's colour is whatever they say. */
/* eslint-disable brand/no-raw-hex -- user-choosable FIRM brand colours, not app chrome */
const PRESETS: ReadonlyArray<readonly [label: string, hex: string]> = [
  ["Navy", "#1f3a5f"],
  ["Burgundy", "#7b2d3b"],
  ["Forest", "#2f5d50"],
  ["Slate", "#3f4a56"],
  ["Bronze", "#a8763e"],
  ["Plum", "#4a3b63"],
];
/* eslint-enable brand/no-raw-hex */

/** Inline Lucide `image` — lucide-react is not a dependency in this repo. */
function ImageIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="1.5" />
      <path d="m21 15-4.5-4.5L7 21" />
    </svg>
  );
}

/** Inline Lucide `loader-circle`. Held still under prefers-reduced-motion —
 *  the button's label changes too, so the state is never colour or spin alone.
 *  jsdom never paints, so nothing in the test suite can see this, the focus
 *  rings, or the dropzone's drag state: they are verified by rendering the page
 *  in a real browser, not by an assertion that would only pretend to. */
function Spinner() {
  return (
    <svg
      className="motion-safe:animate-spin"
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" strokeOpacity={0.3} />
      <path d="M21 12a9 9 0 0 0-9-9" strokeLinecap="round" />
    </svg>
  );
}

/** The hand-off to Stripe. Named so a test can pass its own: jsdom cannot
 *  navigate, and assigning window.location.href there prints a warning
 *  instead of proving the buyer was sent anywhere. */
function navigateTo(url: string) {
  window.location.href = url;
}

const INPUT_CLASS =
  "rounded-[var(--radius-sm)] border border-hair-2 bg-card-2 px-3 py-2.5 text-[15px] text-ink placeholder:text-ink-4 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30";

export function SetupForm({
  initial,
  plan,
  deriveColor = deriveColorFromFile,
  navigate = navigateTo,
}: {
  initial: SetupInitial;
  plan: CheckoutPlan;
  /** Sampler for the logo's colour. Injectable because jsdom decodes no image,
   *  so the suggestion and the guard below it are otherwise unwatchable. */
  deriveColor?: (file: File) => Promise<string | null>;
  /** Where "Continue to payment" sends them. Injectable for the same reason. */
  navigate?: (url: string) => void;
}) {
  const [firmName, setFirmName] = useState(initial.firmName);
  const [advisorName, setAdvisorName] = useState(initial.advisorName);
  const [primaryColor, setPrimaryColor] = useState<string | null>(initial.primaryColor);
  const [logoUrl, setLogoUrl] = useState<string | null>(initial.logoUrl);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  const uploadInFlight = useRef<Promise<void> | undefined>(undefined);
  // A colour restored from the stash is one they picked, on an earlier visit.
  // Starting this at false let a later logo upload silently overwrite it.
  const userPickedColor = useRef(initial.primaryColor !== null);
  const objectUrl = useRef<string | null>(null);
  // The logo the stash actually holds. A failed upload leaves the stash
  // untouched, so the preview must fall back to this rather than to nothing —
  // otherwise it shows no logo while the webhook still provisions the old one.
  const savedLogoUrl = useRef<string | null>(initial.logoUrl);

  const canContinue = firmName.trim() !== "";

  async function onContinue() {
    setBusy(true);
    setError(null);
    // An upload still in flight must delay the button, never fail it — the
    // stash is what the webhook reads, and a half-saved logo is worse than none.
    await uploadInFlight.current;
    const saved = await saveSignupProfile({ firmName, advisorName, primaryColor, plan });
    if (!saved.ok) {
      setError(saved.error);
      setBusy(false);
      return;
    }
    const started = await startSignupCheckout();
    if (!started.ok) {
      setError(started.error);
      setBusy(false);
      return;
    }
    navigate(started.url);
  }

  /** Hand back the memory behind one preview URL, unless a newer file has
   *  already claimed the slot. */
  function releaseObjectUrl(url: string) {
    URL.revokeObjectURL(url);
    if (objectUrl.current === url) objectUrl.current = null;
  }

  function onLogoChosen(file: File) {
    setLogoError(null);
    // Optimistic: they see their logo on the preview immediately, while the
    // upload runs in the background and they keep typing.
    const localUrl = URL.createObjectURL(file);
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = localUrl;
    setLogoUrl(localUrl);
    void deriveColor(file).then((hex) => {
      // Only ever a SUGGESTION — never overwrite a colour they picked themselves.
      if (hex && !userPickedColor.current) setPrimaryColor(hex);
    });
    const fd = new FormData();
    fd.set("file", file);
    uploadInFlight.current = uploadSignupLogo(fd)
      .then((res) => {
        if (!res.ok) {
          setLogoError(res.error);
          setLogoUrl(savedLogoUrl.current);
          return;
        }
        savedLogoUrl.current = res.url;
        setLogoUrl(res.url); // swap the object URL for the durable blob URL
      })
      .catch(() => {
        // A thrown server action must not take the submit down with it: the
        // whole contract is that branding can never block the card.
        setLogoError("Upload failed. Please try again.");
        setLogoUrl(savedLogoUrl.current);
      })
      .finally(() => releaseObjectUrl(localUrl));
  }

  function pickColor(hex: string) {
    userPickedColor.current = true;
    setPrimaryColor(hex);
  }

  return (
    <section className="rise-in w-full py-4">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,21rem)] lg:gap-14">
        {/* ── Your firm ─────────────────────────────────────────────── */}
        {/* A real form: on a two-field page, Enter is the natural way to
            submit. The button is disabled until the firm name is non-empty, so
            implicit submission stays inert until there is something to send. */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onContinue();
          }}
        >
          <div className="mb-5 flex items-center gap-3">
            <span className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-ink-3">
              Set up
            </span>
            <span className="h-px w-12 bg-hair-2" />
          </div>

          <h1 className="text-balance text-3xl font-semibold leading-[1.1] tracking-[-0.02em] text-ink sm:text-4xl">
            Name your firm<span className="dot">.</span>
          </h1>
          <p className="mt-2 text-sm text-ink-3">
            It goes on the cover of every plan your clients read.
          </p>

          <div className="mt-8 flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <label htmlFor="firm-name" className="text-sm font-medium text-ink-2">
                Firm name
              </label>
              <input
                id="firm-name"
                type="text"
                required
                autoFocus
                autoComplete="organization"
                placeholder="Whitfield Wealth Partners"
                value={firmName}
                onChange={(e) => setFirmName(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="advisor-name" className="text-sm font-medium text-ink-2">
                Your name
              </label>
              <input
                id="advisor-name"
                type="text"
                autoComplete="name"
                placeholder="Anne Whitfield"
                value={advisorName}
                onChange={(e) => setAdvisorName(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
          </div>

          {/* ── Make it yours (optional) ─────────────────────────────── */}
          <div className="card mt-8 p-5">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-ink">Make it yours</h2>
              <span className="chip">Optional</span>
            </div>
            <p className="mt-1.5 text-xs text-ink-3">
              You can add this later in Settings.
            </p>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const dropped = e.dataTransfer.files?.[0];
                if (dropped) onLogoChosen(dropped);
              }}
              className={`mt-4 rounded-[var(--radius-md)] border border-dashed p-4 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/30 motion-safe:transition-colors ${
                dragging ? "border-accent bg-accent-wash" : "border-hair-2"
              }`}
            >
              <label
                htmlFor="signup-logo"
                className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-ink-2"
              >
                <ImageIcon className="text-ink-3" />
                Logo
              </label>
              <p id="signup-logo-help" className="mt-1.5 pl-[1.75rem] text-xs text-ink-3">
                Drag a file here, or click to choose. PNG, JPEG, or WebP up to{" "}
                <span className="tabular">2 MB</span>.
              </p>
              <input
                id="signup-logo"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                aria-describedby="signup-logo-help"
                className="sr-only"
                onChange={(e) => {
                  const chosen = e.currentTarget.files?.[0];
                  if (chosen) onLogoChosen(chosen);
                  e.currentTarget.value = "";
                }}
              />
              <div aria-live="polite">
                {logoError ? (
                  <p className="mt-2 flex items-start gap-1.5 pl-[1.75rem] text-xs text-crit">
                    <AlertCircleIcon width={14} height={14} className="mt-px shrink-0" />
                    {logoError}
                  </p>
                ) : null}
              </div>
            </div>

            <fieldset className="mt-5">
              <legend className="text-sm font-medium text-ink-2">Brand colour</legend>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {PRESETS.map(([label, hex]) => {
                  const selected = primaryColor?.toLowerCase() === hex;
                  return (
                    <button
                      key={hex}
                      type="button"
                      aria-label={label}
                      aria-pressed={selected}
                      onClick={() => pickColor(hex)}
                      style={{ backgroundColor: hex }}
                      className={`flex h-9 w-9 items-center justify-center rounded-full border focus:outline-none focus:ring-2 focus:ring-accent/40 ${
                        selected
                          ? "border-ink ring-2 ring-ink ring-offset-2 ring-offset-paper"
                          : "border-hair-2"
                      }`}
                    >
                      {selected ? (
                        <CheckIcon width={15} height={15} strokeWidth={2.5} className="text-white" />
                      ) : null}
                    </button>
                  );
                })}
                <label
                  htmlFor="signup-color"
                  className="ml-2 cursor-pointer text-xs text-ink-3"
                >
                  Custom
                </label>
                <input
                  id="signup-color"
                  type="color"
                  value={resolveAccentColor(primaryColor)}
                  onChange={(e) => pickColor(e.target.value.toLowerCase())}
                  className="h-9 w-12 cursor-pointer rounded-[var(--radius-sm)] border border-hair-2 bg-transparent focus:outline-none focus:ring-2 focus:ring-accent/40"
                />
              </div>
            </fieldset>
          </div>

          {/* ── The card ─────────────────────────────────────────────── */}
          <div className="mt-8 flex flex-col gap-3">
            <div aria-live="polite">
              {error ? (
                <p className="flex items-start gap-1.5 text-sm text-crit">
                  <AlertCircleIcon width={16} height={16} className="mt-0.5 shrink-0" />
                  {error}
                </p>
              ) : null}
            </div>
            <button
              type="submit"
              disabled={!canContinue || busy}
              aria-busy={busy}
              className="btn-primary w-full justify-center disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 sm:w-auto sm:self-start"
            >
              {busy ? (
                <>
                  <Spinner />
                  Starting checkout…
                </>
              ) : (
                <>
                  Continue to payment
                  <ArrowRightIcon width={16} height={16} />
                </>
              )}
            </button>
            <p className="tabular text-[0.72rem] text-ink-3">
              14-day free trial · cancel anytime · card required
            </p>
          </div>
        </form>

        {/* ── What it buys them ────────────────────────────────────── */}
        <div className="mx-auto w-full max-w-[21rem] lg:sticky lg:top-8 lg:self-start">
          <div className="mb-3 flex items-center gap-3">
            <span className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-ink-3">
              Report cover
            </span>
            <span className="h-px w-10 bg-hair-2" />
          </div>
          <div className="overflow-hidden rounded-[var(--radius-md)] border border-hair">
            <CoverPreview
              firmName={firmName}
              logoUrl={logoUrl}
              primaryColor={primaryColor}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

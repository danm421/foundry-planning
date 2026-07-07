// Shared "finishing up" state for the Plaid OAuth resume page. Used both as the
// dynamic-import loading fallback (plaid-oauth-resume-dynamic) and as the live
// "resuming" state inside plaid-oauth-resume, so the chunk-load fallback and the
// mounted state are identical by construction (no flash between them).
export function OAuthResumeSpinner() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <span
        className="h-6 w-6 animate-spin rounded-full border-2 border-hair border-t-accent"
        aria-hidden
      />
      <p className="text-[13px] text-ink-3">Finishing up with your bank…</p>
    </div>
  );
}

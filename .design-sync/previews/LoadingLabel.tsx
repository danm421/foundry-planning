import { LoadingLabel, Skeleton } from "foundry-planning";

// LoadingLabel renders sr-only text (role="status", aria-live="polite") — no
// visual output by design. We pair it with a visible skeleton (its real usage
// context) and an on-screen caption documenting the hidden text, so the
// screenshot has something to grade beyond a blank frame.
export function Basic() {
  return (
    <div className="bg-paper text-ink font-sans p-6">
      <div className="flex flex-col gap-3" style={{ width: 320 }}>
        <Skeleton height="1rem" width={240} />
        <Skeleton height="0.75rem" width={320} />
        <LoadingLabel />
        <p className="text-[11px] uppercase tracking-[0.08em] text-ink-3">
          sr-only text rendered: &ldquo;Loading…&rdquo;
        </p>
      </div>
    </div>
  );
}

export function CustomMessage() {
  return (
    <div className="bg-paper text-ink font-sans p-6">
      <div className="flex flex-col gap-3" style={{ width: 320 }}>
        <Skeleton height="1.75rem" width={180} radius={8} />
        <LoadingLabel>Loading client accounts…</LoadingLabel>
        <p className="text-[11px] uppercase tracking-[0.08em] text-ink-3">
          sr-only text rendered: &ldquo;Loading client accounts…&rdquo;
        </p>
      </div>
    </div>
  );
}

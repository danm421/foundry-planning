// Participation flag shared by every solver technique.
//
// The convention across the engine is that `enabled` is *tri-state*: `false`
// means switched off, and BOTH `true` and `undefined` mean on. Techniques
// arriving from base facts carry no flag at all, so "on" has to be the absence
// of one — a plain boolean toggle would rewrite every untouched technique.

/** Flip a technique's participation, preserving the "undefined means on" form. */
export function flipEnabled<T extends { enabled?: boolean }>(t: T): T {
  return { ...t, enabled: t.enabled === false ? undefined : false };
}

/** True when a technique participates in the projection. */
export function isEnabled(t: { enabled?: boolean }): boolean {
  return t.enabled !== false;
}

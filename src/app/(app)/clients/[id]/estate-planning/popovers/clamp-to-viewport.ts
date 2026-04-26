/**
 * Clamps a popover's top-left corner so it stays fully within the viewport.
 * Math.max(0, ...) prevents the popover from going off-screen to the left or
 * top on narrow/short viewports — a latent bug in the per-file Math.min-only
 * variants this helper replaces.
 */
export function clampToViewport(
  anchor: { clientX: number; clientY: number },
  width: number,
  height: number,
): { left: number; top: number } {
  if (typeof window === "undefined") return { left: anchor.clientX, top: anchor.clientY };
  return {
    left: Math.max(0, Math.min(anchor.clientX, window.innerWidth - width)),
    top: Math.max(0, Math.min(anchor.clientY, window.innerHeight - height)),
  };
}

// src/components/forge/__tests__/media-stubs.ts
import { vi } from "vitest";

/** jsdom has no media playback: give <video> a settable currentTime and
 *  spy-able play/pause so player behaviour can be asserted. */
export function stubMediaElements() {
  const play = vi.fn().mockResolvedValue(undefined);
  const pause = vi.fn();
  Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: play });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", { configurable: true, value: pause });
  Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
    configurable: true,
    get(this: HTMLMediaElement & { _t?: number }) {
      return this._t ?? 0;
    },
    set(this: HTMLMediaElement & { _t?: number }, v: number) {
      this._t = v;
    },
  });
  return { play, pause };
}

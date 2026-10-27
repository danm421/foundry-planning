import { vi } from "vitest";

/** jsdom lays nothing out, so every row measures 0×0 and a keyboard drag has
 *  nowhere to go. Stack each list row 40px below the one before it. */
export function stackRowsVertically() {
  return vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const li = this.closest("li");
    const top = li?.parentElement ? Array.from(li.parentElement.children).indexOf(li) * 40 : 0;
    return { x: 0, y: top, top, left: 0, right: 300, bottom: top + 30, width: 300, height: 30, toJSON: () => ({}) };
  });
}

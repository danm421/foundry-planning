import { it, expect } from "vitest";
import { summarizeGrant } from "../grant-state";

it("buckets shares across states", () => {
  const s = summarizeGrant({
    grantType: "nqso", currentYear: 2026,
    tranches: [
      { vestYear: 2025, shares: 100, sharesExercised: 60, sharesSold: 20 },
      { vestYear: 2028, shares: 100, sharesExercised: 0, sharesSold: 0 },
    ],
  });
  expect(s.granted).toBe(200);
  expect(s.unvested).toBe(100);
  expect(s.sold).toBe(20);
  expect(s.exercisedHeld).toBe(40);
  expect(s.vestedHeld).toBe(40);
});

it("RSU has no exercise step: vested shares are held until sold", () => {
  const s = summarizeGrant({
    grantType: "rsu", currentYear: 2026,
    tranches: [
      { vestYear: 2025, shares: 100, sharesExercised: 0, sharesSold: 30 }, // vested: 70 held, 30 sold
      { vestYear: 2028, shares: 100, sharesExercised: 0, sharesSold: 0 },  // unvested
    ],
  });
  expect(s.granted).toBe(200);
  expect(s.unvested).toBe(100);
  expect(s.sold).toBe(30);
  expect(s.exercisedHeld).toBe(0);
  expect(s.vestedHeld).toBe(70);
});

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        paper: "#0b0c0f",
        card: "#15171f",
        "card-2": "#1a1d27",
        "card-hover": "#1f2330",
        ink: "#f4f5f7",
        "ink-2": "#d4d7de",
        "ink-3": "#aab0bc",
        "ink-4": "#848a98",
        hair: "#2b2f3a",
        "hair-2": "#3a4051",
        accent: "#1f9e8c",
        "accent-ink": "#4fd0bf",
        "accent-wash": "rgba(31, 158, 140, 0.16)",
        good: "#4ade80",
        warn: "#fbbf24",
        crit: "#fb8d8d",
      },
    },
  },
};

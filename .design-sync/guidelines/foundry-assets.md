# Foundry brand assets

The real, shipped Foundry marks. **Inline these directly instead of inventing a
logo.** Every file below is self-contained SVG (no external refs, no bitmaps) —
paste the source straight into a layout. Treat them as fixed artwork: place and
scale, don't re-typeset or recolor. The verdigris in every mark is the brand
accent `#1f9e8c` — the same `--color-accent` reserved for action elsewhere.

## Which asset, when

| Asset | Use on | Notes |
|---|---|---|
| **Horizontal lockup** | app header, nav, marketing, email | The default. Dark canvas → `lockup-horizontal`; cream/light → `-light`. |
| **Stacked lockup** | narrow / centered — sign-in, splash, mobile, covers | Mark centered over the wordmark. |
| **Wordmark** | tight spaces where the icon would crowd — footers, inline | `wordmark-light` on dark, `wordmark-dark` on light. |
| **FP mark (color)** | the monogram alone — avatars, compact chrome | Transparent, no card. |
| **FP icon** | app icon / favicon / tile | Dimensional card + glow; not for inline UI. |

**Rules.** Keep clear space of at least the cap-height of the "F" around any
lockup. Minimum legible lockup width ~180px — below that, use the wordmark or the
mark alone. The lockups' `PLANNING` eyebrow is baked into the artwork (a
letter-spaced mono) — leave it; don't re-typeset the marks. **Never place a
Foundry mark on a client-facing report or PDF** — those are the advisor's
documents and carry the firm's own logo (the white-label layer).

## lockup-horizontal.svg

**Primary lockup — dark surfaces.** Mark + `Foundry.` + `PLANNING` eyebrow. Use in the app header, nav, marketing, and email on the near-black canvas (`bg-paper`).

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="560" height="128" viewBox="0 0 560 128" fill="none">
  <defs>
    <linearGradient id="cardSheenL" x1="157" y1="151" x2="1099" y2="1100" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#171c26"></stop>
      <stop offset="42%" stop-color="#10141c"></stop>
      <stop offset="100%" stop-color="#0b0e14"></stop>
    </linearGradient>
    <linearGradient id="goldFrontL" x1="384" y1="342" x2="885" y2="764" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#5fd6c5"></stop>
      <stop offset="42%" stop-color="#1f9e8c"></stop>
      <stop offset="100%" stop-color="#1a8e7d"></stop>
    </linearGradient>
    <linearGradient id="goldDeepL" x1="515" y1="640" x2="621" y2="997" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#1f9e8c"></stop>
      <stop offset="52%" stop-color="#15806f"></stop>
      <stop offset="100%" stop-color="#0c5a4f"></stop>
    </linearGradient>
  </defs>
  <svg x="16" y="16" width="96" height="96" viewBox="157 151 942 949" preserveAspectRatio="xMidYMid meet" overflow="visible">
    <rect x="157" y="151" width="942" height="949" rx="178" ry="178" fill="url(#cardSheenL)"></rect>
    <path d="M845 351 L393 351 L393 810 L476 888 L477 888 L477 434 L478 433 L762 433 Z" fill="url(#goldFrontL)"></path>
    <path d="M800 504 L764 496 L533 496 L533 581 L757 581 L782 588 L794 596 L804 607 L810 621 L810 638 L803 653 L791 664 L769 672 L535 673 L552 690 L551 691 L533 674 L533 931 L618 998 L618 756 L768 756 L807 749 L834 737 L855 722 L874 701 L883 687 L890 671 L896 647 L897 622 L892 596 L880 569 L864 547 L846 530 L824 515 Z" fill="url(#goldFrontL)"></path>
    <path d="M533 674 L618 756 L618 998 L533 931 Z" fill="url(#goldDeepL)"></path>
    <path d="M393 810 L476 888 L477 433 L393 351 Z" fill="url(#goldFrontL)" opacity=".96"></path>
    <path d="M393 351 H845 L834 362 H402 V798 L393 810 Z" fill="#5fd6c5" opacity=".22"></path>
  </svg>
  <text x="132" y="78" font-family="Inter, system-ui, sans-serif" font-size="48" font-weight="700" letter-spacing="-1.5" fill="#f4f5f7">Foundry<tspan fill="#1f9e8c" dx="-2">.</tspan></text>
  <text x="134" y="102" font-family="&#39;JetBrains Mono&#39;, ui-monospace, monospace" font-size="11" font-weight="500" letter-spacing="3" fill="#9aa0a6">PLANNING</text>
</svg>
```

## lockup-horizontal-light.svg

**Primary lockup — light / cream surfaces.** Same lockup tuned for the cream light theme (`data-theme="light"`) and print.

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="560" height="128" viewBox="0 0 560 128" fill="none">
  <defs>
    <linearGradient id="cardCreamLh2" x1="157" y1="151" x2="1099" y2="1100" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#fefdf8"></stop>
      <stop offset="100%" stop-color="#f5f1e6"></stop>
    </linearGradient>
    <linearGradient id="goldFrontLhh" x1="384" y1="342" x2="885" y2="764" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#5fd6c5"></stop>
      <stop offset="42%" stop-color="#1f9e8c"></stop>
      <stop offset="100%" stop-color="#1a8e7d"></stop>
    </linearGradient>
    <linearGradient id="goldDeepLhh" x1="515" y1="640" x2="621" y2="997" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#1f9e8c"></stop>
      <stop offset="52%" stop-color="#15806f"></stop>
      <stop offset="100%" stop-color="#0a4a40"></stop>
    </linearGradient>
  </defs>
  <svg x="16" y="16" width="96" height="96" viewBox="157 151 942 949" preserveAspectRatio="xMidYMid meet">
    <rect x="157" y="151" width="942" height="949" rx="178" ry="178" fill="url(#cardCreamLh2)" stroke="#e8e2d0" stroke-width="2"></rect>
    <path d="M845 351 L393 351 L393 810 L476 888 L477 888 L477 434 L478 433 L762 433 Z" fill="url(#goldFrontLhh)"></path>
    <path d="M800 504 L764 496 L533 496 L533 581 L757 581 L782 588 L794 596 L804 607 L810 621 L810 638 L803 653 L791 664 L769 672 L535 673 L552 690 L551 691 L533 674 L533 931 L618 998 L618 756 L768 756 L807 749 L834 737 L855 722 L874 701 L883 687 L890 671 L896 647 L897 622 L892 596 L880 569 L864 547 L846 530 L824 515 Z" fill="url(#goldFrontLhh)"></path>
    <path d="M533 674 L618 756 L618 998 L533 931 Z" fill="url(#goldDeepLhh)"></path>
    <path d="M393 810 L476 888 L477 433 L393 351 Z" fill="url(#goldFrontLhh)" opacity=".96"></path>
  </svg>
  <text x="132" y="78" font-family="Inter, system-ui, sans-serif" font-size="48" font-weight="700" letter-spacing="-1.5" fill="#0f1115">Foundry<tspan fill="#1f9e8c" dx="-2">.</tspan></text>
  <text x="134" y="102" font-family="&#39;JetBrains Mono&#39;, ui-monospace, monospace" font-size="11" font-weight="500" letter-spacing="3" fill="#6b7280">PLANNING</text>
</svg>
```

## lockup-stacked.svg

**Stacked lockup — narrow / centered.** Sign-in, splash, mobile, section covers. Dark surface; mark centered over the wordmark.

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="280" height="280" viewBox="0 0 280 280" fill="none">
  <defs>
    <linearGradient id="cardSheenS" x1="157" y1="151" x2="1099" y2="1100" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#171c26"></stop>
      <stop offset="42%" stop-color="#10141c"></stop>
      <stop offset="100%" stop-color="#0b0e14"></stop>
    </linearGradient>
    <linearGradient id="goldFrontS" x1="384" y1="342" x2="885" y2="764" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#5fd6c5"></stop>
      <stop offset="42%" stop-color="#1f9e8c"></stop>
      <stop offset="100%" stop-color="#1a8e7d"></stop>
    </linearGradient>
    <linearGradient id="goldDeepS" x1="515" y1="640" x2="621" y2="997" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#1f9e8c"></stop>
      <stop offset="52%" stop-color="#15806f"></stop>
      <stop offset="100%" stop-color="#0c5a4f"></stop>
    </linearGradient>
  </defs>
  <svg x="92" y="32" width="96" height="96" viewBox="157 151 942 949" preserveAspectRatio="xMidYMid meet">
    <rect x="157" y="151" width="942" height="949" rx="178" ry="178" fill="url(#cardSheenS)"></rect>
    <path d="M845 351 L393 351 L393 810 L476 888 L477 888 L477 434 L478 433 L762 433 Z" fill="url(#goldFrontS)"></path>
    <path d="M800 504 L764 496 L533 496 L533 581 L757 581 L782 588 L794 596 L804 607 L810 621 L810 638 L803 653 L791 664 L769 672 L535 673 L552 690 L551 691 L533 674 L533 931 L618 998 L618 756 L768 756 L807 749 L834 737 L855 722 L874 701 L883 687 L890 671 L896 647 L897 622 L892 596 L880 569 L864 547 L846 530 L824 515 Z" fill="url(#goldFrontS)"></path>
    <path d="M533 674 L618 756 L618 998 L533 931 Z" fill="url(#goldDeepS)"></path>
    <path d="M393 810 L476 888 L477 433 L393 351 Z" fill="url(#goldFrontS)" opacity=".96"></path>
    <path d="M393 351 H845 L834 362 H402 V798 L393 810 Z" fill="#5fd6c5" opacity=".22"></path>
  </svg>
  <text x="140" y="180" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="38" font-weight="700" letter-spacing="-1.2" fill="#f4f5f7">Foundry<tspan fill="#1f9e8c" dx="-2">.</tspan></text>
  <text x="140" y="208" text-anchor="middle" font-family="&#39;JetBrains Mono&#39;, ui-monospace, monospace" font-size="11" font-weight="500" letter-spacing="4" fill="#9aa0a6">PLANNING</text>
</svg>
```

## wordmark-light.svg

**Wordmark on dark.** `Foundry` + the verdigris trailing dot, no mark. Use in tight spots where the icon would crowd — footers, inline references.

```svg
<svg width="320" height="80" viewBox="0 0 320 80" fill="none" xmlns="http://www.w3.org/2000/svg">
  <text x="0" y="58" font-family="Inter, system-ui, sans-serif" font-size="56" font-weight="700" letter-spacing="-2" fill="#f4f5f7">Foundry<tspan fill="#1f9e8c" dx="-2">.</tspan></text>
</svg>
```

## wordmark-dark.svg

**Wordmark on light.** Same wordmark with dark ink for cream/white surfaces and print.

```svg
<svg width="320" height="80" viewBox="0 0 320 80" fill="none" xmlns="http://www.w3.org/2000/svg">
  <text x="0" y="58" font-family="Inter, system-ui, sans-serif" font-size="56" font-weight="700" letter-spacing="-2" fill="#0f1115">Foundry<tspan fill="#1f9e8c" dx="-2">.</tspan></text>
</svg>
```

## fp-mark-color.svg

**FP mark (color, transparent).** The monogram alone, no card. Avatars, compact chrome, a favicon at size. Sits on any background.

```svg
<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1254" height="1254" viewBox="0 0 1254 1254" role="img" aria-label="Foundry Planning logo colored on transparent background">
  <defs>
    <linearGradient id="goldFront" x1="384" y1="342" x2="885" y2="764" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#5fd6c5"></stop>
      <stop offset="42%" stop-color="#1f9e8c"></stop>
      <stop offset="100%" stop-color="#1a8e7d"></stop>
    </linearGradient>

    <linearGradient id="goldDeep" x1="515" y1="640" x2="621" y2="997" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#1f9e8c"></stop>
      <stop offset="52%" stop-color="#15806f"></stop>
      <stop offset="100%" stop-color="#0c5a4f"></stop>
    </linearGradient>

    <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="9" flood-color="#000000" flood-opacity=".20"></feDropShadow>
    </filter>
  </defs>

  <g filter="url(#softShadow)">
    <path d="M845 351 L393 351 L393 810 L476 888 L477 888 L477 434 L478 433 L762 433 Z" fill="url(#goldFront)"></path>
    <path d="M800 504 L764 496 L533 496 L533 581 L757 581 L782 588 L794 596 L804 607 L810 621 L810 638 L803 653 L791 664 L769 672 L535 673 L552 690 L551 691 L533 674 L533 931 L618 998 L618 756 L768 756 L807 749 L834 737 L855 722 L874 701 L883 687 L890 671 L896 647 L897 622 L892 596 L880 569 L864 547 L846 530 L824 515 Z" fill="url(#goldFront)"></path>
    <path d="M533 674 L618 756 L618 998 L533 931 Z" fill="url(#goldDeep)" opacity=".98"></path>
    <path d="M393 810 L476 888 L477 433 L393 351 Z" fill="url(#goldFront)" opacity=".96"></path>
    <path d="M533 674 L618 756" fill="none" stroke="#06352d" stroke-width="2" stroke-opacity=".45"></path>
    <path d="M393 351 H845 L834 362 H402 V798 L393 810 Z" fill="#5fd6c5" opacity=".22"></path>
    <path d="M533 496 H764 C793 496 820 505 846 524 C819 514 794 509 764 509 H546 V568 H533 Z" fill="#5fd6c5" opacity=".20"></path>
  </g>
</svg>
```

## fp-icon.svg

**FP app icon.** Dimensional rounded-square with glow — app icon, favicon, home-screen tile. Do **not** drop this inline in UI; use the mark or a lockup for that.

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1254 1254" role="img" aria-labelledby="fpTitle fpDesc">
  <title id="fpTitle">Foundry Planning FP Icon</title>
  <desc id="fpDesc">A dark rounded-square icon with a dimensional amber FP monogram.</desc>
  <defs>
    <radialGradient id="outerGlow" cx="50%" cy="48%" r="70%">
      <stop offset="0%" stop-color="#141923"></stop>
      <stop offset="72%" stop-color="#0f131b"></stop>
      <stop offset="100%" stop-color="#08090c"></stop>
    </radialGradient>
    <linearGradient id="cardSheen" x1="157" y1="151" x2="1099" y2="1100" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#171c26"></stop>
      <stop offset="42%" stop-color="#10141c"></stop>
      <stop offset="100%" stop-color="#0b0e14"></stop>
    </linearGradient>
    <radialGradient id="cardCenter" cx="50%" cy="45%" r="62%">
      <stop offset="0%" stop-color="#171c27" stop-opacity=".88"></stop>
      <stop offset="56%" stop-color="#111620" stop-opacity=".78"></stop>
      <stop offset="100%" stop-color="#0c0f15" stop-opacity="1"></stop>
    </radialGradient>
    <linearGradient id="goldFront" x1="384" y1="342" x2="885" y2="764" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#5fd6c5"></stop>
      <stop offset="42%" stop-color="#1f9e8c"></stop>
      <stop offset="100%" stop-color="#1a8e7d"></stop>
    </linearGradient>
    <linearGradient id="goldDeep" x1="515" y1="640" x2="621" y2="997" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#1f9e8c"></stop>
      <stop offset="52%" stop-color="#15806f"></stop>
      <stop offset="100%" stop-color="#0c5a4f"></stop>
    </linearGradient>
    <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="9" flood-color="#000000" flood-opacity=".34"></feDropShadow>
    </filter>
  </defs>
  <rect width="1254" height="1254" fill="#000000"></rect>
  <rect x="157" y="151" width="942" height="949" rx="178" ry="178" fill="url(#cardSheen)"></rect>
  <rect x="157" y="151" width="942" height="949" rx="178" ry="178" fill="url(#cardCenter)" opacity=".9"></rect>
  <g filter="url(#softShadow)">
    <path d="M845 351 L393 351 L393 810 L476 888 L477 888 L477 434 L478 433 L762 433 Z" fill="url(#goldFront)"></path>
    <path d="M800 504 L764 496 L533 496 L533 581 L757 581 L782 588 L794 596 L804 607 L810 621 L810 638 L803 653 L791 664 L769 672 L535 673 L552 690 L551 691 L533 674 L533 931 L618 998 L618 756 L768 756 L807 749 L834 737 L855 722 L874 701 L883 687 L890 671 L896 647 L897 622 L892 596 L880 569 L864 547 L846 530 L824 515 Z" fill="url(#goldFront)"></path>
    <path d="M533 674 L618 756 L618 998 L533 931 Z" fill="url(#goldDeep)" opacity=".98"></path>
    <path d="M393 810 L476 888 L477 433 L393 351 Z" fill="url(#goldFront)" opacity=".96"></path>
    <path d="M533 674 L618 756" fill="none" stroke="#06352d" stroke-width="2" stroke-opacity=".45"></path>
    <path d="M393 351 H845 L834 362 H402 V798 L393 810 Z" fill="#5fd6c5" opacity=".22"></path>
    <path d="M533 496 H764 C793 496 820 505 846 524 C819 514 794 509 764 509 H546 V568 H533 Z" fill="#5fd6c5" opacity=".20"></path>
  </g>
</svg>
```

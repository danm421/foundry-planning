/// <reference types="nativewind/types" />

// TS 6's `moduleResolution: "bundler"` type-checks side-effect imports
// (TS2882) even though Metro/NativeWind resolve `global.css` at bundle
// time via `nativewind/metro`. Declare the module so `import "../global.css"`
// in app/_layout.tsx type-checks without pulling in a full CSS-modules setup.
declare module "*.css";

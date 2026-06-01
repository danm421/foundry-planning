import { RuleTester } from "eslint";
import rule from "./no-raw-hex.mjs";

const rt = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: "module" } });

rt.run("no-raw-hex", rule, {
  valid: [
    { code: 'const x = "bg-card text-ink-2";' },
    { code: 'const x = "border-hair text-ink-3";' },
    // allow-listed hex passes
    { code: 'const c = "#1a1d27";', options: [{ allow: ["#1a1d27"] }] },
  ],
  invalid: [
    { code: 'const c = "#1a1d27";', errors: 1 },
    { code: 'const c = "bg-[#0b0c0f]";', errors: 1 },
    { code: "const c = `text-[#f59e0b]`;", errors: 1 },
  ],
});

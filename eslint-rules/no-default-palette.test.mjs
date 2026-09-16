import { RuleTester } from "eslint";
import rule from "./no-default-palette.mjs";

const rt = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: "module" } });

rt.run("no-default-palette", rule, {
  valid: [
    { code: 'const x = "bg-card-2 text-ink-3";' },
    { code: 'const x = "border-hair-3 hover:border-accent";' },
    // a word that merely contains a palette name
    { code: 'const x = "gray-matter";' },
    // a palette name with no tone is not a Tailwind colour utility
    { code: 'const x = "text-gray";' },
    // a tone with no utility prefix is something else entirely
    { code: 'const x = "col-span-2 gap-300";' },
    // allow-listed class passes
    { code: 'const x = "text-gray-300";', options: [{ allow: ["text-gray-300"] }] },
  ],
  invalid: [
    { code: 'const x = "text-gray-300";', errors: 1 },
    { code: 'const x = "bg-gray-800 border-gray-700";', errors: 2 },
    { code: "const x = `flex ${y} bg-slate-800`;", errors: 1 },
    // variants still carry the class
    { code: 'const x = "hover:bg-zinc-700";', errors: 1 },
    { code: 'const x = "divide-neutral-800 text-stone-400";', errors: 2 },
  ],
});

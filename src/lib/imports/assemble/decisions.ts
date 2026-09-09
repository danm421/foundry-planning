/**
 * Structured facts the merge produced, and the ONLY input the narrator is
 * allowed to read. Keeping this a closed union is what makes the prose
 * untruthful-by-construction impossible: a sentence with no decision behind
 * it cannot be rendered.
 *
 * The type lives under `assemble/` rather than beside the chat surface that
 * reads it, so `lib/imports` never imports from the feature that consumes it.
 */
export type MergeDecision =
  | {
      kind: "superseded";
      /** Account name as it will appear in the table. */
      account: string;
      /** ISO date of the statement whose figures survived. */
      kept: string;
      /** ISO dates of the statements set aside, newest first. */
      dropped: string[];
      basis: "date" | "field-count";
    }
  | {
      kind: "rollup-excluded";
      label: string;
      value: number;
      /** How many sibling rows the total covered. Always >= 2. */
      coversCount: number;
    }
  | {
      kind: "value-conflict";
      account: string;
      values: number[];
      asOf: string;
    }
  | {
      kind: "undated";
      account: string;
      /** Source file names, in the order the documents were read. */
      fileNames: string[];
    };

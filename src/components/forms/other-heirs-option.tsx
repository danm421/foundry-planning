import { OTHER_HEIRS_LABEL } from "@/engine/other-heirs";

/** The picker value that names the built-in Other Heirs. */
export const OTHER_HEIRS_VALUE = "other_heirs";

/** The built-in Other Heirs, always offered last in a beneficiary picker. */
export function OtherHeirsOptgroup() {
  return (
    <optgroup label="Other">
      <option value={OTHER_HEIRS_VALUE}>{OTHER_HEIRS_LABEL}</option>
    </optgroup>
  );
}

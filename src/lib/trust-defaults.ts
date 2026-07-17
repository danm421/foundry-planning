/**
 * Default grantor-trust status for a NEWLY-CREATED trust of the given subtype.
 *
 *  - `idgt` — an Intentionally Defective *Grantor* Trust is grantor by
 *    definition; a non-grantor IDGT is a contradiction in terms.
 *  - `clt`  — the CLT feature was specced around the grantor CLUT, which takes
 *    the upfront §170(f)(2)(B) deduction. Non-grantor CLTs stay fully
 *    expressible (the user can untick the box) and the engine models them
 *    correctly via annual §642(c).
 *  - `crt`  — deliberately false: under IRC §664(c) a CRT is exempt in either
 *    configuration, so the flag has no tax effect on a CRT at all.
 *
 * Applies to CREATION only. Editing an existing trust must never overwrite a
 * stored value.
 *
 * Shared by the trust form and the solver's entity builder, which previously
 * disagreed: the form defaulted every subtype to false while the solver set
 * `isGrantor: subType === "idgt"`.
 */
export function defaultIsGrantorFor(subType: string): boolean {
  return subType === "idgt" || subType === "clt";
}

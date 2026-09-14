// src/lib/entity-extraction/index.ts
//
// Deliberately NARROW. Only the two names a consumer outside this directory
// actually imports are re-exported; everything else is reached at its own
// module.
//
// The reason is a mocking hazard this feature already had to work around:
// `map-entity-pass.ts` documents why it must take `matchByIdentity` from
// `./matcher` and not from here — stubbing the barrel to fake the AI-calling
// `extractMapEntities` would otherwise silently stub out the real matching
// under test, and every row would come back undefined-matched. A wide barrel
// gives every symbol a second import path and makes that trap re-reachable
// for the next caller.
export { extractMapEntities } from "./orchestrator";
export type { ExistingRow } from "./matcher";

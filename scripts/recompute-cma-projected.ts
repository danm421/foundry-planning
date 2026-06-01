import { writeFileSync } from "node:fs";
import horizonSource from "../src/lib/cma-projected-horizon.source.json";
import cmaDefaults from "../src/lib/cma-defaults.generated.json";
import {
  buildProjectedAssetClasses,
  type HorizonSource,
} from "../src/lib/cma-projected-build";
import type { SeedAssetClass } from "../src/lib/cma-seed";

const assetClasses = buildProjectedAssetClasses(
  horizonSource as HorizonSource,
  cmaDefaults.assetClasses as SeedAssetClass[],
);

// Timestamp via env keeps the script deterministic (mirrors recompute-cma.ts).
const payload = {
  meta: {
    source: `Horizon Actuarial Survey of CMAs, ${horizonSource.meta.edition} Edition (${horizonSource.meta.horizon}), Exhibit 17`,
    edition: horizonSource.meta.edition,
    horizon: horizonSource.meta.horizon,
    generatedAt: process.env.RECOMPUTE_STAMP ?? "UNSTAMPED",
    note: "Arithmetic = geometric + σ²/2 for Horizon-sourced classes; carried classes copy historical verbatim. See per-class provenance.",
  },
  assetClasses,
};

writeFileSync(
  "src/lib/cma-projected.generated.json",
  JSON.stringify(payload, null, 2) + "\n",
);
console.log(
  `Wrote src/lib/cma-projected.generated.json (${assetClasses.length} classes)`,
);

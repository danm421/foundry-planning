// src/domain/forge/help/asset-version.ts
//
// A help video's or poster's version: the first 12 hex of its sha256. It names
// the stored file (knowledge-hub/<slug>/<version>.mp4|.jpg) and is the ?v= the
// player asks for, so the URL the Hub builds and the check the route makes
// can't drift apart. Zod-free so the browser bundle can import it.

export const assetVersion = (asset: { sha256: string }) => asset.sha256.slice(0, 12);

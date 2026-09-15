import { generateProtectedResourceMetadata, metadataCorsOptionsRequestHandler } from "mcp-handler";
import { deriveIssuer } from "@/lib/mcp/principal";

// The MCP endpoint IS the protected resource identifier (RFC 9728) — never
// the bare app origin. Kept as an identical expression in
// `src/app/api/mcp/route.ts`, which enforces this same string as the
// expected token `aud` (Task 12 / D4): the two must never drift apart, and
// there is no third file both routes could safely share it from without
// pulling the whole MCP tool registry into this otherwise-tiny metadata
// endpoint's bundle.
const RESOURCE = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://app.foundryplanning.com"}/api/mcp`;

export function GET() {
  return Response.json(
    generateProtectedResourceMetadata({
      // `deriveIssuer()` is the SAME derivation `resolveMcpPrincipal` verifies
      // tokens against (src/lib/mcp/principal.ts). Reading env vars here
      // independently risks advertising an authorization server that isn't
      // the one actually enforced — see Ruling R74 / D3.
      authServerUrls: [deriveIssuer()],
      resourceUrl: RESOURCE,
      additionalMetadata: {
        resource_name: "Foundry Planning",
        scopes_supported: ["profile", "email", "user:org:read"],
        bearer_methods_supported: ["header"],
        resource_documentation: "https://www.foundryplanning.com/docs/claude-connector",
      },
    }),
  );
}

export const OPTIONS = metadataCorsOptionsRequestHandler();

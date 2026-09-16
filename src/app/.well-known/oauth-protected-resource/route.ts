import { generateProtectedResourceMetadata, metadataCorsOptionsRequestHandler } from "mcp-handler";
import { deriveIssuer, MCP_RESOURCE_URL } from "@/lib/mcp/principal";

export function GET() {
  let authServerUrl: string;
  try {
    // `deriveIssuer()` is the SAME derivation `resolveMcpPrincipal` verifies
    // tokens against (src/lib/mcp/principal.ts). Reading env vars here
    // independently risks advertising an authorization server that isn't
    // the one actually enforced — see Ruling R74 / D3. `MCP_RESOURCE_URL`
    // is that same file's single source of truth for the `resource` value
    // too (Task 12 fix round 1 / F5) — both routes already import this
    // module, so nothing is shared here that wasn't already in each
    // route's bundle.
    authServerUrl = deriveIssuer();
  } catch (err) {
    // F8 (Task 12 fix round 1, minor m6): `deriveIssuer()` throws
    // `McpUnauthorizedError` on a garbled or absent publishable key. Left
    // uncaught, that 500s this GET with no log line — a deploy
    // misconfiguration would surface only as a client-side connector
    // failure with nothing server-side to point at it.
    console.error("MCP metadata: cannot derive the Clerk issuer — check the Clerk publishable key", err);
    return Response.json(
      { error: "server_error", error_description: "This server is not configured for MCP access." },
      { status: 500 },
    );
  }
  return Response.json(
    generateProtectedResourceMetadata({
      authServerUrls: [authServerUrl],
      resourceUrl: MCP_RESOURCE_URL,
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

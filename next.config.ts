import type { NextConfig } from "next";

// Content-Security-Policy. Clerk, Neon, Azure OpenAI, and data: img URIs
// (used by react-pdf chart snapshots) need explicit allowlisting.
// Starting in report-only mode — flip the header name to
// "Content-Security-Policy" once the CSP report endpoint shows no real
// violations in production.
const csp = [
  "default-src 'self'",
  // Next.js' React runtime still needs 'unsafe-inline' for style elements
   // and Clerk ships inline bootstrapping. Revisit once nonces are wired.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.clerk.accounts.dev https://*.clerk.com https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://img.clerk.com",
  "font-src 'self' data:",
  "connect-src 'self' https://*.clerk.accounts.dev https://*.clerk.com https://clerk-telemetry.com https://*.neon.tech https://*.openai.azure.com https://*.upstash.io",
  "frame-src 'self' https://challenges.cloudflare.com",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy-Report-Only", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const apiNoCache = [
  { key: "Cache-Control", value: "no-store, max-age=0, must-revalidate" },
];

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "20mb",
    },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/api/:path*", headers: apiNoCache },
    ];
  },
};

export default nextConfig;

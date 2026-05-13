import { withSentryConfig } from "@sentry/nextjs";
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
  "img-src 'self' data: blob: https://img.clerk.com https://*.public.blob.vercel-storage.com",
  "font-src 'self' data:",
  // Sentry ingest domains are only needed as a fallback — browser ingestion
  // normally tunnels through /monitoring (see `tunnelRoute` below).
  "connect-src 'self' https://*.clerk.accounts.dev https://*.clerk.com https://clerk-telemetry.com https://*.neon.tech https://*.openai.azure.com https://*.upstash.io https://*.sentry.io https://*.ingest.sentry.io https://*.ingest.us.sentry.io",
  "frame-src 'self' https://challenges.cloudflare.com",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
  // Legacy reporting — still the most-supported browser API.
  "report-uri /api/csp-report",
  // Modern Reporting API — names a group declared in Reporting-Endpoints.
  "report-to csp-endpoint",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy-Report-Only", value: csp },
  // Modern Reporting API endpoint group referenced by `report-to` above.
  { key: "Reporting-Endpoints", value: 'csp-endpoint="/api/csp-report"' },
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
  async redirects() {
    return [
      {
        source: "/clients/:id/estate-tax-report",
        destination: "/clients/:id/estate-planning/estate-tax",
        permanent: true,
      },
      {
        source: "/clients/:id/estate-transfer-report",
        destination: "/clients/:id/estate-planning/estate-transfer",
        permanent: true,
      },
      {
        source: "/clients/:id/gift-tax-report",
        destination: "/clients/:id/estate-planning/gift-tax",
        permanent: true,
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "foundry-finance",

  project: "foundry-planning",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",

  webpack: {
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  },
});

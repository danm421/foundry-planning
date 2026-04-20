import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ensureClerkFallbackInstalled } from "@/lib/install-clerk-fallback";
import { getAdvisorContextOrFallback } from '@foundry/auth';
import { ImpersonationBanner } from '@foundry/ui';
import { resolveAdvisorDisplayName } from '@/lib/advisor-display-name';
ensureClerkFallbackInstalled();

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Foundry Planning",
  description: "Cash flow-based financial planning for advisors",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  let banner: React.ReactNode = null;
  try {
    const ctx = await getAdvisorContextOrFallback();
    if (ctx.kind === 'impersonated') {
      const name = await resolveAdvisorDisplayName(ctx.clerkUserId);
      banner = <ImpersonationBanner advisorDisplayName={name} endSessionUrl="/api/impersonation/end" />;
    }
  } catch {
    // no context yet (e.g., sign-in pages) — never block the layout
  }

  return (
    <ClerkProvider>
      <html
        lang="en"
        className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
      >
        <body className="min-h-full flex flex-col bg-gray-950 text-gray-100">
          {banner}
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}

import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import { Inter, B612_Mono } from "next/font/google";
import { SentryUserContext } from "@/components/sentry-user-context";
import { ToastProvider } from "@/components/toast";
import { resolveTheme, THEME_COOKIE } from "@/lib/theme";
import { colors } from "@/brand";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const b612Mono = B612_Mono({
  variable: "--font-b612",
  subsets: ["latin"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "Foundry Planning",
  description: "Cash flow-based financial planning for advisors",
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  // Browser chrome color (static metadata, can't read CSS vars) — dark paper.
  themeColor: colors.paper,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const theme = resolveTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <ClerkProvider
      localization={{
        organizationProfile: {
          invitePage: {
            // Surface per-seat billing at the moment of invite. Each org member
            // is a billable seat (syncSeatQuantity in the Clerk membership
            // webhook sets the Stripe quantity to the live member count).
            subtitle:
              "Each person you invite is added as a billable seat on your subscription.",
          },
        },
      }}
      appearance={{
        theme: theme === "dark" ? dark : undefined,
        variables: {
          colorBackground: "var(--color-card)",
          colorForeground: "var(--color-ink)",
          colorMutedForeground: "var(--color-ink-2)",
          colorNeutral: "var(--color-ink)",
          colorInput: "var(--color-card-2)",
          colorInputForeground: "var(--color-ink)",
          colorPrimary: "var(--color-accent)",
        },
        elements: {
          card: "border border-white/10 shadow-2xl",
        },
      }}
    >
      <html
        lang="en"
        data-theme={theme}
        className={`${inter.variable} ${b612Mono.variable} h-full antialiased ${theme}`}
        suppressHydrationWarning
      >
        <body className="min-h-full flex flex-col">
          <SentryUserContext />
          <ToastProvider>{children}</ToastProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}

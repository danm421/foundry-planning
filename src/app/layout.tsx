import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import { Inter, Geist_Mono } from "next/font/google";
import { SentryUserContext } from "@/components/sentry-user-context";
import { ToastProvider } from "@/components/toast";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
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
  themeColor: "#0b0c0f",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider
      appearance={{
        baseTheme: dark,
        variables: {
          colorBackground: "#17181c",
          colorForeground: "#f3f4f6",
          colorMutedForeground: "#c7cbd4",
          colorNeutral: "#f3f4f6",
          colorInput: "#0b0c0f",
          colorInputForeground: "#f3f4f6",
          colorPrimary: "#f59e0b",
        },
        elements: {
          card: "border border-white/10 shadow-2xl",
        },
      }}
    >
      <html
        lang="en"
        className={`${inter.variable} ${geistMono.variable} h-full antialiased dark`}
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

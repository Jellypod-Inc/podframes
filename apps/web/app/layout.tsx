import type { Metadata } from "next";
import { DM_Sans, Geist_Mono } from "next/font/google";
import "./globals.css";

// Speechbase's typographic identity — DM Sans for display/body, Geist Mono for machine values.
const sans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

const mono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "podframes — animated AI podcast videos, powered by Speechbase",
  description:
    "Turn a topic into a fully animated, AI-hosted podcast video. Mix any TTS providers into one conversation with Speechbase, lip-sync each host to the real audio, and render with HyperFrames.",
  openGraph: {
    title: "podframes",
    description: "Topic → multi-provider conversation → animated podcast video.",
    url: siteUrl,
    siteName: "podframes",
    type: "website",
  },
  twitter: { card: "summary_large_image", title: "podframes" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}

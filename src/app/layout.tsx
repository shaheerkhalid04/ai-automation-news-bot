import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Dispatch — Autonomous Newsdesk",
  description:
    "A multi-agent crew that finds the day's stories, edits them into a briefing, and files it to Slack and Google Sheets every six hours.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} antialiased`}>
        <div className="ambient" aria-hidden="true" />
        <div className="relative z-10">{children}</div>
      </body>
    </html>
  );
}

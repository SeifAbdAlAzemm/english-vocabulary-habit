import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "English Vocabulary Habit",
  description: "A little practice. Words you can make your own.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col"><a className="skip-link" href="#main">Skip to content</a><Suspense fallback={<main className="page-content" aria-busy="true">Opening your learning space…</main>}>{children}</Suspense></body>
    </html>
  );
}

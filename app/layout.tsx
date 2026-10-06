import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Spotter",
  description: "Live name spotting for sports broadcasters",
};

// System fonts only: no web-font fetch, so the app works in a booth with no internet
// other than the Deepgram connection.
// Typed by hand rather than with LayoutProps, which only exists once `next build`
// has generated route types, so `tsc` on a fresh clone would fail.
export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className="h-full bg-white antialiased">
      <body className="min-h-full bg-white text-black">{children}</body>
    </html>
  );
}

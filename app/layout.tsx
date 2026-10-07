import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ApprovalProvider } from "@/components/auth/Approval";
import { WaitingBanner } from "@/components/SiteHeader";
import { getViewer } from "@/lib/server/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "Spotter",
  description: "Live name spotting for sports broadcasters",
};

// System fonts only: no web-font fetch, so the app works in a booth with no internet
// other than the Deepgram connection.
// Typed by hand rather than with LayoutProps, which only exists once `next build`
// has generated route types, so `tsc` on a fresh clone would fail.
export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  // Read here so every page gets the banner without asking for it.
  const viewer = await getViewer();
  const waiting = viewer.status === "waiting";

  return (
    <html lang="en" className="h-full bg-white antialiased">
      <body className="min-h-full bg-white text-black">
        {waiting && <WaitingBanner />}
        <ApprovalProvider approved={!waiting}>{children}</ApprovalProvider>
      </body>
    </html>
  );
}

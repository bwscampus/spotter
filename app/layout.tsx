import type { Metadata } from "next";
import type { ReactNode } from "react";
import { plexMono, plexSans } from "@/components/appFont";
import { ViewerStamp } from "@/components/auth/BrowserData";
import { ErrorReporter } from "@/components/ErrorReporter";
import { SiteChrome } from "@/components/SiteChrome";
import { UploadTermsProvider } from "@/components/auth/UploadTerms";
import { ConfirmEmailBanner } from "@/components/auth/ConfirmEmailBanner";
import { getUploadTermsAccepted, getViewerEmail, getViewerEmailConfirmed, getViewerId } from "@/lib/auth/viewer";
import { APP_NAME, SITE_NAME, SITE_URL, TAGLINE } from "@/lib/ui/site";
import "./globals.css";

const DESCRIPTION = `${TAGLINE} Built for the booth: Chrome on a laptop with a microphone.`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${APP_NAME}: player cards for high school announcers`,
    template: `%s | ${APP_NAME}`,
  },
  description: DESCRIPTION,
  applicationName: APP_NAME,
  // The image is app/opengraph-image.png, which Next adds to both.
  openGraph: {
    type: "website",
    url: "/",
    siteName: SITE_NAME,
    title: `${SITE_NAME}: player cards for high school announcers`,
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME}: player cards for high school announcers`,
    description: DESCRIPTION,
  },
  // The build's commit, for matching a page to what it was built from. Not shown on screen.
  other: { "x-commit": process.env.NEXT_PUBLIC_GIT_COMMIT ?? "unknown" },
};

// Fonts: IBM Plex Sans and Mono for the dashboard, and Atkinson Hyperlegible
// Next on the live stage, all through next/font, which downloads them at build
// time and serves them from Spotter's own build. Nothing is fetched from Google
// at game time, so the app works in a booth with no internet other than the
// Deepgram connection. Plex is only CSS variables here; the .dash class applies
// it, so the live screen keeps its own look.
// Typed by hand rather than with LayoutProps, which only exists once `next build`
// has generated route types, so `tsc` on a fresh clone would fail.
export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  // Read here so every page gets the header without asking for it.
  const [viewerId, email, uploadTermsAccepted, emailConfirmed] = await Promise.all([
    getViewerId(),
    getViewerEmail(),
    getUploadTermsAccepted(),
    getViewerEmailConfirmed(),
  ]);

  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable} h-full bg-white antialiased`}>
      <body className="min-h-full bg-white text-black">
        {/* Who this browser's open game and logs belong to, before any page reads them (audit M3). */}
        <ViewerStamp userId={viewerId} />
        <ErrorReporter />
        <SiteChrome email={viewerId === null ? null : email} />
        {viewerId !== null && !emailConfirmed && <ConfirmEmailBanner />}
        <UploadTermsProvider accepted={uploadTermsAccepted}>
          {children}
        </UploadTermsProvider>
      </body>
    </html>
  );
}
